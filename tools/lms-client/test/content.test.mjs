import assert from 'node:assert/strict';
import { test } from 'node:test';

const lesson = (id, number, date, options = {}) => ({
  id: `/api/lessons/${id}`,
  _id: id,
  position: number,
  startDatetime: date,
  isHidden: false,
  translations: { edges: [{ node: { name: `Урок ${number}`, locale: 'uk', empty: false } }] },
  userLessons: { edges: [{ node: { status: 2 } }] },
  ...options,
});
const statuses = {
  edges: [
    { node: { _id: 0, name: 'unavailable' } },
    { node: { _id: 1, name: 'live' } },
    { node: { _id: 2, name: 'in_process' } },
    { node: { _id: 4, name: 'done' } },
  ],
  pageInfo: { hasNextPage: false, endCursor: null },
};
const page = (collection, hasNextPage, totalCount = 2) => ({
  lessons: { collection, paginationInfo: { totalCount, hasNextPage } },
});
const connection = nodes => ({
  edges: nodes.map(node => ({ node })),
  pageInfo: { hasNextPage: false, endCursor: null },
});
const reader = pages => ({
  calls: [],
  async query(query, variables) {
    this.calls.push({ query, variables });
    if (query.includes('LessonStatuses')) return { userLessonStatuses: statuses };
    return pages[variables.page - 1];
  },
});

test('lessons collects capped pages, preserves number zero, missing translation and stable IDs', async () => {
  const { listLessons } = await import('../dist/lessons.js');
  const r = reader([
    page([lesson(900, 0, '2026-01-01T00:00:00Z')], true),
    page([lesson(410, 13, '2026-02-01T00:00:00Z', { translations: { edges: [] } })], false),
  ]);
  const result = await listLessons(r, 5467);
  assert.equal(result.lessons.length, 2);
  assert.equal(result.lessons[0].number, 0);
  assert.equal(result.lessons[1].id, 410);
  assert.equal(result.lessons[1].name, null);
  assert.equal(result.lessons[1].translationStatus, 'missing');
  assert.equal(r.calls.filter(c => c.variables.page).length, 2);
  assert.equal(r.calls.at(-1).variables.course, '/api/courses/5467');
  assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
});

test('latest uses dates and availability; explicit number selects the requested lesson', async () => {
  const { listLessons, selectLesson } = await import('../dist/lessons.js');
  const r = reader([
    page(
      [
        lesson(1, 12, '2026-05-01T00:00:00Z'),
        lesson(2, 13, '2026-04-01T00:00:00Z'),
        lesson(3, 14, '2026-06-01T00:00:00Z', { isHidden: true }),
        lesson(4, 15, '2026-07-01T00:00:00Z', {
          userLessons: { edges: [{ node: { status: 0 } }] },
        }),
        lesson(5, 16, '2099-01-01T00:00:00Z'),
        lesson(6, 17, null),
        lesson(7, 18, '2026-08-01T00:00:00Z', {
          userLessons: { edges: [{ node: { status: 1 } }] },
        }),
        lesson(8, 19, '2026-08-01T00:00:00Z', { userLessons: { edges: [] } }),
      ],
      false,
      8,
    ),
  ]);
  const { lessons } = await listLessons(r, 5467);
  assert.equal(selectLesson(lessons, { latest: true }).id, 1);
  assert.equal(selectLesson(lessons, { lesson: 13, latest: true }).id, 2);
  assert.equal(selectLesson(lessons, { lessonId: 2 }).number, 13);
  assert.throws(() => selectLesson(lessons, { lesson: 404 }), { code: 'LESSON_NOT_FOUND' });
  assert.throws(() => selectLesson(lessons, { lesson: 14 }), { code: 'LESSON_UNAVAILABLE' });
  assert.throws(() => selectLesson([], { latest: true }), { code: 'LESSON_NOT_FOUND' });
});

test('invalid shapes, duplicate pages and inconsistent counts are explicit errors', async () => {
  const { listLessons } = await import('../dist/lessons.js');
  for (const pages of [
    [{ lessons: null }],
    [page([lesson(1, 1, 'nonsense')], false, 1)],
    [page([lesson(1, 1, null)], true), page([lesson(1, 1, null)], false)],
    [page([], true)],
    [page([lesson(1, 1, null)], false, 2)],
  ])
    await assert.rejects(listLessons(reader(pages), 5467), { code: 'API_RESPONSE_INVALID' });
});

test('homework follows relation and cursor pages, retains original blocks and converts HTML', async () => {
  const { getHomework } = await import('../dist/homework.js');
  const { listLessons } = await import('../dist/lessons.js');
  const { lessons } = await listLessons(
    reader([page([lesson(410, 13, '2026-02-01T00:00:00Z')], false, 1)]),
    5467,
  );
  const description = JSON.stringify([
    {
      type: 'text',
      content:
        '<h2>Умова</h2><p>Зроби <strong>entities</strong> &amp; <code>relations</code>.</p><ul><li>Перше</li></ul><p><a href="https://example.org/docs">Документація</a></p><pre><code>const x = 1;</code></pre><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    },
  ]);
  const calls = [];
  const r = {
    async query(query, variables) {
      calls.push({ query, variables });
      return {
        lesson: {
          id: '/api/lessons/410',
          homeworks: variables.after
            ? connection([
                {
                  id: '/api/lesson_homeworks/991',
                  _id: 991,
                  translations: {
                    edges: [{ node: { name: 'ДЗ', description, locale: 'uk', empty: false } }],
                  },
                },
              ])
            : { edges: [], pageInfo: { hasNextPage: true, endCursor: 'next' } },
        },
      };
    },
  };
  const result = await getHomework(r, 5467, lessons[0]);
  assert.equal(calls[0].variables.id, '/api/lessons/410');
  assert.equal(calls[1].variables.after, 'next');
  assert.equal(result.homeworks[0].id, 991);
  assert.equal(result.homeworks[0].descriptionRaw, description);
  assert.match(result.homeworks[0].html, /<h2>Умова<\/h2>/);
  const md = result.homeworks[0].markdown;
  for (const pattern of [
    /## Умова/,
    /\*\*entities\*\*/,
    /`relations`/,
    /-\s+Перше/,
    /\[Документація\]\(https:\/\/example.org\/docs\)/,
    /```/,
    /\| A \| B \|/,
  ])
    assert.match(md, pattern);
  assert.equal(
    result.homeworks[0].url,
    'https://lms.robotdreams.cc/course/5467/lesson/410/homework/991',
  );
  assert.equal(result.status, 'available');
});

test('missing homework and missing translation remain distinct successful results', async () => {
  const { getHomework } = await import('../dist/homework.js');
  const selected = { id: 410, iri: '/api/lessons/410', number: 13 };
  const r = nodes => ({
    async query() {
      return { lesson: { id: selected.iri, homeworks: connection(nodes) } };
    },
  });
  assert.equal((await getHomework(r([]), 5467, selected)).status, 'no_homework');
  const result = await getHomework(
    r([{ id: '/api/lesson_homeworks/99', _id: 99, translations: { edges: [] } }]),
    5467,
    selected,
  );
  assert.equal(result.homeworks[0].translationStatus, 'missing');
  assert.equal(result.homeworks[0].html, null);
});

test('description preserves unsupported blocks and malformed structured content fails explicitly', async () => {
  const { convertDescription } = await import('../dist/homework.js');
  const raw = JSON.stringify([
    { type: 'text', content: '<p>Hello</p>' },
    { type: 'file', content: { id: 'file' } },
  ]);
  const result = convertDescription(raw);
  assert.equal(result.descriptionRaw, raw);
  assert.deepEqual(result.warnings, ['UNSUPPORTED_DESCRIPTION_BLOCK']);
  assert.match(result.markdown, /Hello/);
  assert.equal(convertDescription('<p>Plain HTML</p>').markdown, 'Plain HTML');
  assert.throws(() => convertDescription('[broken'), { code: 'API_RESPONSE_INVALID' });
});

test('ambiguous lesson numbers require an ID and status cursors cannot loop', async () => {
  const { listLessons, selectLesson } = await import('../dist/lessons.js');
  const result = await listLessons(
    reader([
      page([lesson(11, 13, '2026-01-01T00:00:00Z'), lesson(12, 13, '2026-01-02T00:00:00Z')], false),
    ]),
    5467,
  );
  assert.throws(() => selectLesson(result.lessons, { lesson: 13 }), { code: 'LESSON_AMBIGUOUS' });
  assert.equal(selectLesson(result.lessons, { lessonId: 12 }).id, 12);
  const looping = {
    async query() {
      return {
        userLessonStatuses: { edges: [], pageInfo: { hasNextPage: true, endCursor: 'same' } },
      };
    },
  };
  await assert.rejects(listLessons(looping, 5467), { code: 'API_RESPONSE_INVALID' });
});

test('homework rejects another lesson, duplicate IDs and repeated cursors', async () => {
  const { getHomework } = await import('../dist/homework.js');
  const selected = { id: 410, iri: '/api/lessons/410', number: 13 };
  const hw = { id: '/api/lesson_homeworks/99', _id: 99, translations: { edges: [] } };
  for (const data of [
    { lesson: null },
    { lesson: { id: '/api/lessons/999', homeworks: connection([]) } },
    { lesson: { id: selected.iri, homeworks: connection([hw, hw]) } },
    {
      lesson: {
        id: selected.iri,
        homeworks: { edges: [], pageInfo: { hasNextPage: true, endCursor: 'same' } },
      },
    },
  ])
    await assert.rejects(
      getHomework(
        {
          async query() {
            return data;
          },
        },
        5467,
        selected,
      ),
      { code: 'API_RESPONSE_INVALID' },
    );
});
