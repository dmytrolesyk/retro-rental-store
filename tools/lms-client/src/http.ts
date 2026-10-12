import { CookieJar } from 'tough-cookie';
import { ClientError } from './errors.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class HttpClient {
  constructor(private readonly timeoutMs = 15_000) {}

  async request(url: string, jar: CookieJar, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookies = await jar.getCookieString(url);
    if (cookies) headers.set('cookie', cookies);
    headers.set('accept', 'application/json');
    try {
      const response = await fetch(url, {
        ...init,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new ClientError(
          'AUTH_INTERACTION_REQUIRED',
          'LMS повернула перенаправлення. Може бути потрібна браузерна перевірка; автоматичного обходу немає.',
          4,
        );
      }
      for (const cookie of response.headers.getSetCookie()) {
        try {
          await jar.setCookie(cookie, url);
        } catch {
          await response.body?.cancel();
          throw new ClientError('API_RESPONSE_INVALID', 'LMS повернула некоректну cookie.', 5);
        }
      }
      return response;
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError(
        'NETWORK_ERROR',
        'Запит LMS не завершився. Перевір мережу та повтори команду.',
        5,
      );
    }
  }
}

export async function jsonBody(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    throw new ClientError(
      'API_RESPONSE_INVALID',
      'LMS повернула неочікувану відповідь замість JSON.',
      5,
    );
  }
}
