# Фідбек до зданої домашки в LMS

Перевірено 2026-10-22. `homework` і `sync` отримують умову, а не відповіді
лектора. Для фідбеку використай `AuthClient.requestGraphql()` із
`tools/lms-client/dist/auth.js`: він повторно використовує сесію й оновлює її
без виведення credentials. Запускай Node з кореня репозиторію; не відкривай
session.json у вивід і не копіюй токен в аргументи або тимчасові скрипти.

ID домашки спершу отримай через CLI `homework`; не виводь його з номера лекції.
Приклад read-only запиту для домашки 54346 (лекція 14):

```graphql
query Feedback($homework: String!, $page: Int!) {
  userLessonHomeworks(homework: $homework, page: $page, itemsPerPage: 10) {
    collection {
      id
      points
      updatedAt
      userHomeworkComments(first: 50) {
        totalCount
        pageInfo { hasNextPage endCursor }
        edges {
          node { id text createdAt points requestForRework }
        }
      }
    }
  }
}
```

Параметри прикладу: `homework: "/api/lesson_homeworks/54346"`, `page: 1`.
Якщо сторінка заповнена, перевір наступну; для comments при `hasNextPage`
продовжуй cursor-пагінацію через `after`. Не називай частковий результат повним.
`text` містить HTML. Читай актуальну відповідь після останньої здачі:
старий нуль за заглушку не є поточною оцінкою. Зістав зауваження з кодом та
раніше погодженими винятками. Не пиши коментарі/здачу в LMS автоматично.
