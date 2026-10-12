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
export const MATERIAL_COURSE = `query MaterialCourse($id: ID!) {
  course(id: $id) { translations(locale: "uk", first: 1) { edges { node { name } } } }
}`;
export const MATERIAL_TYPES = `query MaterialTypes($after: String) {
  lessonMaterialTypes(first: 30, after: $after) {
    edges { node { _id name } } pageInfo { hasNextPage endCursor }
  }
}`;
// LessonMaterial._id is advertised in the schema but fails on the actual API.
export const MATERIALS = `query ClientMaterials($lesson: String!, $page: Int!) {
  lessonMaterialHasLessons(lesson: $lesson, page: $page, itemsPerPage: 30) {
    collection { id position lessonMaterial {
      id type subtitle { contentUrl }
      translations(locale: "uk", first: 1) { edges { node { name description link locale empty } } }
    } }
    paginationInfo { totalCount hasNextPage }
  }
}`;
export const MATERIAL_SUBTITLES = `query MaterialSubtitles($id: ID!, $after: String) {
  lesson(id: $id) { id medias(first: 30, after: $after) {
    edges { node { id subtitle { contentUrl } } } pageInfo { hasNextPage endCursor }
  } }
}`;

export const VIDEO_MEDIAS = `query ClientVideoMedias($id: ID!, $after: String) {
  lesson(id: $id) { id medias(first: 30, after: $after) {
    edges { node { id name } } pageInfo { hasNextPage endCursor }
  } }
}`;
export const VIDEO_RESOLUTIONS = `query ClientVideoResolutions($media: String!, $after: String) {
  lessonMediaResolutions(lessonMedia: $media, first: 30, after: $after) {
    edges { node { id type link durationInSeconds } } pageInfo { hasNextPage endCursor }
  }
}`;
