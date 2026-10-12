import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
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
import { type Lesson } from './lessons.js';
import { HOMEWORK } from './queries.js';

const converter = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});
converter.use(gfm);
converter.remove(['script', 'style']);

export function convertDescription(descriptionRaw: string) {
  let html = descriptionRaw;
  const warnings: string[] = [];
  if (/^\s*[[{]/.test(descriptionRaw)) {
    let blocks: unknown;
    try {
      blocks = JSON.parse(descriptionRaw) as unknown;
    } catch {
      invalidResponse();
    }
    if (!Array.isArray(blocks)) invalidResponse();
    const parts: string[] = [];
    for (const value of blocks) {
      const block = record(value);
      if (typeof block.type !== 'string') invalidResponse();
      if (block.type === 'text') {
        if (typeof block.content !== 'string') invalidResponse();
        parts.push(block.content);
      } else if (!warnings.length) warnings.push('UNSUPPORTED_DESCRIPTION_BLOCK');
    }
    html = parts.join('\n');
  }
  return { descriptionRaw, html, markdown: converter.turndown(html), warnings };
}

export async function getHomework(client: GraphqlReader, course: number, lesson: Lesson) {
  const homeworks: {
    id: number;
    iri: string;
    name: string | null;
    translationStatus: 'available' | 'missing';
    descriptionRaw: string | null;
    html: string | null;
    markdown: string | null;
    warnings: string[];
    url: string;
  }[] = [];
  const seenIds = new Set<number>();
  const cursors = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 1000; page++) {
    const data = await client.query(HOMEWORK, { id: lesson.iri, after });
    const result = record(data.lesson);
    if (result.id !== lesson.iri) invalidResponse();
    const connection = result.homeworks;
    for (const node of nodes(connection)) {
      const id = numericId(node, 'lesson_homeworks');
      if (seenIds.has(id)) invalidResponse();
      seenIds.add(id);
      const translation = ukrainianTranslation(node.translations);
      const description = translation ? nullableString(translation.description) : null;
      homeworks.push({
        id,
        iri: `/api/lesson_homeworks/${String(id)}`,
        name: translation ? nullableString(translation.name) : null,
        translationStatus: translation ? 'available' : 'missing',
        ...(description === null
          ? { descriptionRaw: null, html: null, markdown: null, warnings: [] }
          : convertDescription(description)),
        url: `https://lms.robotdreams.cc/course/${String(course)}/lesson/${String(lesson.id)}/homework/${String(id)}`,
      });
    }
    after = nextCursor(connection);
    if (!after)
      return {
        courseId: course,
        lesson,
        status: homeworks.length ? 'available' : 'no_homework',
        homeworks,
        fetchedAt: new Date().toISOString(),
      };
    if (cursors.has(after)) invalidResponse();
    cursors.add(after);
  }
  invalidResponse();
}
