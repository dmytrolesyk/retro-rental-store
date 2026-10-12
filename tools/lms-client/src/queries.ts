// Verified against the live LMS schema on 2026-10-12. Only read-only selections.
export const LESSON_STATUSES = `query LessonStatuses($after: String) {
  userLessonStatuses(first: 30, after: $after) {
    edges { node { _id name } } pageInfo { hasNextPage endCursor }
  }
}`;
export const LESSONS = `query ClientLessons($course: String!, $page: Int!) {
  lessons(course: $course, page: $page, itemsPerPage: 30, order: { position: "asc" }) {
    collection {
      id _id position startDatetime isHidden
      translations(locale: "uk", first: 1) { edges { node { name locale empty } } }
      userLessons(first: 1) { edges { node { status } } }
    }
    paginationInfo { totalCount hasNextPage }
  }
}`;
export const HOMEWORK = `query ClientHomework($id: ID!, $after: String) {
  lesson(id: $id) {
    id
    homeworks(first: 30, after: $after) {
      edges { node {
        id _id
        translations(locale: "uk", first: 1) { edges { node { name description locale empty } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
