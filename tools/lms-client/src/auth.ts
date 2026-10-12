import { CookieJar, type SerializedCookieJar } from 'tough-cookie';
import { SessionStore, type Session } from './session-store.js';
import { ClientError, authRequired } from './errors.js';
import { HttpClient, isRecord, jsonBody } from './http.js';
import { DEFAULT_COURSE } from './config.js';

export const AUTH_ORIGIN = 'https://lms.robotdreams.cc';
export const GRAPHQL_URL = 'https://lms.academius.io/api/graphql';
const REFRESH_MARGIN_MS = 60_000;

function responseExpiry(value: unknown): number {
  // Despite its name, LMS uses expires_in_seconds as an absolute Unix timestamp.
  // Treat the access token as opaque; LMS decides whether it is valid.
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 8_640_000_000_000
  ) {
    throw new ClientError(
      'API_RESPONSE_INVALID',
      'LMS не повернула коректний expires_in_seconds.',
      5,
    );
  }
  return value * 1000;
}

function sessionFrom(body: unknown, jar: CookieJar): Session {
  if (
    !isRecord(body) ||
    typeof body.access_token !== 'string' ||
    !body.access_token.trim() ||
    body.access_token.length > 65_536
  ) {
    throw new ClientError('API_RESPONSE_INVALID', 'LMS не повернула access_token.', 5);
  }
  const expiresAt = responseExpiry(body.expires_in_seconds);
  if (expiresAt <= Date.now())
    throw new ClientError('API_RESPONSE_INVALID', 'LMS повернула вже прострочений токен.', 5);
  return { version: 1, accessToken: body.access_token, expiresAt, cookieJar: serializeJar(jar) };
}

function serializeJar(jar: CookieJar): SerializedCookieJar {
  const saved = jar.serializeSync();
  if (!saved) throw new ClientError('SESSION_IO', 'Не вдалося зберегти cookie jar.');
  return saved;
}

interface AuthOptions {
  store?: SessionStore;
  authOrigin?: string;
  graphqlUrl?: string;
  timeoutMs?: number;
}

export class AuthClient {
  private readonly store: SessionStore;
  private readonly http: HttpClient;
  private readonly authOrigin: string;
  private readonly graphqlUrl: string;
  constructor(options: AuthOptions = {}) {
    this.store = options.store ?? new SessionStore();
    this.authOrigin = options.authOrigin ?? AUTH_ORIGIN;
    this.graphqlUrl = options.graphqlUrl ?? GRAPHQL_URL;
    this.http = new HttpClient(options.timeoutMs);
  }

  async login(credentials: { email: string; password: string }): Promise<{ expiresAt: string }> {
    if (!credentials.email.trim() || !credentials.password) {
      throw new ClientError('LOGIN_FAILED', 'Email і пароль обов’язкові.', 4);
    }
    return this.store.transaction(async tx => {
      const jar = new CookieJar();
      const response = await this.http.request(
        `${this.authOrigin}/api/login?_remember_me_=true&lg=uk`,
        jar,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: credentials.email.trim(),
            password: credentials.password,
            _remember_me: true,
          }),
        },
      );
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new ClientError(
          'LOGIN_FAILED',
          'Вхід не вдався. Перевір email і пароль; за потреби перевір вхід у браузері.',
          4,
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ClientError('HTTP_ERROR', 'LMS не виконала запит входу. Спробуй пізніше.', 5);
      }
      const session = sessionFrom(await jsonBody(response), jar);
      if (!(await jar.getCookieString(`${this.authOrigin}/api/token/refresh`))) {
        throw new ClientError(
          'API_RESPONSE_INVALID',
          'Вхід повернув токен, але не cookie для refresh. Постійна сесія недоступна.',
          5,
        );
      }
      await tx.write(session);
      return { expiresAt: new Date(session.expiresAt).toISOString() };
    });
  }

  async logout(): Promise<{ loggedOut: true }> {
    await this.store.transaction(tx => tx.clear());
    return { loggedOut: true };
  }

  // A deliberately tiny read-only probe for point 2, not the lessons client.
  async checkSession() {
    return this.readCourse(true);
  }

  async readCourse(
    forceRefresh = false,
  ): Promise<{ course: { id: string; name: string }; expiresAt: string }> {
    return this.store.transaction(async tx => {
      const stored = await tx.read();
      if (!stored) throw authRequired();
      let session: Session = stored;
      const jar = CookieJar.deserializeSync(session.cookieJar);
      const refresh = async () => {
        const response = await this.http.request(`${this.authOrigin}/api/token/refresh`, jar);
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          await tx.clear();
          throw authRequired();
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new ClientError('HTTP_ERROR', 'LMS не змогла оновити сесію. Спробуй пізніше.', 5);
        }
        session = sessionFrom(await jsonBody(response), jar);
        await tx.write(session);
      };
      // The stored server expiry schedules refresh; a 401 still triggers one retry.
      if (forceRefresh || session.expiresAt <= Date.now() + REFRESH_MARGIN_MS) await refresh();
      const read = () =>
        this.http.request(this.graphqlUrl, jar, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${session.accessToken}`,
          },
          body: JSON.stringify({
            query:
              'query SessionCourseCheck($id: ID!) { course(id: $id) { id translations(locale: "uk") { edges { node { name } } } } }',
            variables: { id: `/api/courses/${String(DEFAULT_COURSE)}` },
          }),
        });
      let response = await read();
      if (response.status === 401) {
        await response.body?.cancel();
        await refresh();
        response = await read();
      }
      if (response.status === 401) {
        await response.body?.cancel();
        await tx.clear();
        throw authRequired();
      }
      // Persist any server cookie changes even when the read returns an error.
      session.cookieJar = serializeJar(jar);
      await tx.write(session);
      if (!response.ok) {
        await response.body?.cancel();
        throw new ClientError('HTTP_ERROR', 'LMS не дозволила прочитати курс.', 5);
      }
      const body = await jsonBody(response);
      if (!isRecord(body))
        throw new ClientError('API_RESPONSE_INVALID', 'LMS повернула некоректний JSON курсу.', 5);
      if (Array.isArray(body.errors) && body.errors.length)
        throw new ClientError('GRAPHQL_ERROR', 'GraphQL повернув помилку читання курсу.', 5);
      const course = isRecord(body.data) ? body.data.course : undefined;
      const translations = isRecord(course) ? course.translations : undefined;
      const edges = isRecord(translations) ? translations.edges : undefined;
      const first: unknown = Array.isArray(edges) ? edges[0] : undefined;
      const node = isRecord(first) ? first.node : undefined;
      if (
        !isRecord(course) ||
        typeof course.id !== 'string' ||
        !isRecord(node) ||
        typeof node.name !== 'string'
      )
        throw new ClientError('API_RESPONSE_INVALID', 'LMS не повернула очікувані дані курсу.', 5);
      return {
        course: { id: course.id, name: node.name },
        expiresAt: new Date(session.expiresAt).toISOString(),
      };
    });
  }
}
