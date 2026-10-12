import { ClientError } from './errors.js';
import {
  type GraphqlReader,
  invalidResponse,
  nextCursor,
  nodes,
  nullableString,
  numericId,
  record,
  ukrainianTranslation,
} from './graphql.js';
import { LESSONS, LESSON_STATUSES } from './queries.js';

export interface Lesson {
  id: number;
  iri: string;
  number: number | null;
  name: string | null;
  translationStatus: 'available' | 'missing';
  startsAt: string | null;
  hidden: boolean;
  accessStatus: string | null;
  available: boolean;
  url: string;
}
export interface LessonSelector {
  lesson?: number;
  lessonId?: number;
  latest?: boolean;
}
const MAX_PAGES = 1000;

async function lessonStatuses(client: GraphqlReader): Promise<Map<number, string>> {
  const statuses = new Map<number, string>();
  const seen = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await client.query(LESSON_STATUSES, { after });
    const connection = data.userLessonStatuses;
    for (const node of nodes(connection)) {
      if (
        typeof node._id !== 'number' ||
        !Number.isSafeInteger(node._id) ||
        typeof node.name !== 'string' ||
        statuses.has(node._id)
      )
        invalidResponse();
      statuses.set(node._id, node.name);
    }
    after = nextCursor(connection);
    if (!after) return statuses;
    if (seen.has(after)) invalidResponse();
    seen.add(after);
  }
  invalidResponse();
}

export async function listLessons(client: GraphqlReader, course: number) {
  const statuses = await lessonStatuses(client);
  const lessons: Lesson[] = [];
  const seen = new Set<number>();
  let total: number | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await client.query(LESSONS, { course: `/api/courses/${String(course)}`, page });
    const connection = record(data.lessons);
    const info = record(connection.paginationInfo);
    if (
      !Array.isArray(connection.collection) ||
      typeof info.totalCount !== 'number' ||
      !Number.isSafeInteger(info.totalCount) ||
      info.totalCount < 0 ||
      typeof info.hasNextPage !== 'boolean'
    )
      invalidResponse();
    total ??= info.totalCount;
    if (total !== info.totalCount || (info.hasNextPage && !connection.collection.length))
      invalidResponse();
    for (const value of connection.collection) {
      const node = record(value);
      const id = numericId(node, 'lessons');
      if (seen.has(id)) invalidResponse();
      seen.add(id);
      const number = node.position;
      if (
        number !== null &&
        (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0)
      )
        invalidResponse();
      const startsAt = nullableString(node.startDatetime);
      if (startsAt !== null && !Number.isFinite(Date.parse(startsAt))) invalidResponse();
      if (typeof node.isHidden !== 'boolean') invalidResponse();
      const translation = ukrainianTranslation(node.translations);
      const userLessons = nodes(node.userLessons);
      if (userLessons.length > 1) invalidResponse();
      const status = userLessons[0]?.status;
      if (status !== undefined && (typeof status !== 'number' || !statuses.has(status)))
        invalidResponse();
      const accessStatus = typeof status === 'number' ? (statuses.get(status) ?? null) : null;
      lessons.push({
        id,
        iri: `/api/lessons/${String(id)}`,
        number,
        name: translation ? nullableString(translation.name) : null,
        translationStatus: translation ? 'available' : 'missing',
        startsAt,
        hidden: node.isHidden,
        accessStatus,
        available:
          !node.isHidden &&
          accessStatus !== null &&
          !['unavailable', 'live'].includes(accessStatus),
        url: `https://lms.robotdreams.cc/course/${String(course)}/lesson/${String(id)}`,
      });
    }
    if (lessons.length > total) invalidResponse();
    if (!info.hasNextPage) {
      if (lessons.length !== total) invalidResponse();
      lessons.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.id - b.id);
      return { courseId: course, lessons, fetchedAt: new Date().toISOString() };
    }
  }
  invalidResponse();
}

export function selectLesson(lessons: Lesson[], selector: LessonSelector): Lesson {
  let selected: Lesson | undefined;
  if (selector.lesson !== undefined) {
    const matches = lessons.filter(lesson => lesson.number === selector.lesson);
    if (matches.length > 1)
      throw new ClientError(
        'LESSON_AMBIGUOUS',
        'Номер лекції неоднозначний. Вкажи --lesson-id.',
        2,
      );
    selected = matches[0];
  } else if (selector.lessonId !== undefined) {
    selected = lessons.find(lesson => lesson.id === selector.lessonId);
  } else if (selector.latest) {
    selected = lessons
      .filter(
        lesson =>
          lesson.available && lesson.startsAt !== null && Date.parse(lesson.startsAt) <= Date.now(),
      )
      .sort(
        (a, b) => Date.parse(b.startsAt ?? '') - Date.parse(a.startsAt ?? '') || b.id - a.id,
      )[0];
  }
  if (!selected)
    throw new ClientError('LESSON_NOT_FOUND', 'Лекцію не знайдено серед доступних даних курсу.', 2);
  if (!selected.available)
    throw new ClientError('LESSON_UNAVAILABLE', 'Ця лекція ще недоступна.', 5);
  return selected;
}
