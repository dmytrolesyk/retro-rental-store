# Повний lifecycle запиту в NestJS

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104314
Отримано: 2026-10-12T13:41:06.656Z

## Домашнє завдання

LMS ID: 54341

**Курсовий проєкт:** ні (фінал training-артефакту)

**Постановка**

Фінальна частина mini-Nest. Ви добудовуєте **повний життєвий цикл запиту** — той самий, через який у NestJS проходить кожен HTTP-виклик:

Middleware → Guard → Interceptor (before) → Pipe → Handler

                → Interceptor (after) → Exception Filter

Після цього ДЗ питання «чим guard відрізняється від interceptor» перестане існувати: ви знатимете, що вони відрізняються **місцем виклику у вашому власному циклі** і тим, що кожен може повернути.

Стартова точка — гілка part-2-http.

**Що потрібно зробити**

**1\. Guard**

Виконується **до** обробника й до валідації. Повертає boolean: false → 403, обробник не викликається. Реалізуйте AuthGuard, що перевіряє заголовок Authorization.

**2\. Interceptor**

Обгортає виклик обробника: код **до**, виклик, код **після**. Реалізуйте LoggingInterceptor, який міряє тривалість і логує METHOD /path — 12.3 ms.

**3\. Pipe**

Трансформує/валідує аргумент **безпосередньо перед** передачею в обробник. Перепишіть валідацію з ДЗ #7 на **Zod** (zod@4) і залиште її саме як pipe.

**4\. Exception Filter**

Ловить **будь-яку** помилку з ланцюга й перетворює на HTTP-відповідь:

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Помилка</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Відповідь</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">NotFoundError</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">404</span><span class="ql-bg-transparent ql-color-#000000"> з осмисленим повідомленням</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">ValidationError</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">400</span><span class="ql-bg-transparent ql-color-#000000"> зі списком полів</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#000000">будь-що інше</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#188038">500</span><span class="ql-bg-transparent ql-color-#000000"> </span><strong class="ql-bg-transparent ql-color-#000000">без</strong><span class="ql-bg-transparent ql-color-#000000"> стек-трейсу назовні</span></td></tr></tbody></table>

**5\. AsyncLocalStorage + request-id**

На вході генеруєте requestId (або берете із заголовка X-Request-Id), кладете у AsyncLocalStorage, і **будь-який** код глибоко в стеку — сервіс, репозиторій, логер — дістає його **без передачі параметром**. Той самий id повертається клієнту в заголовку відповіді.

**6\. Порядок доведено тестом**

Тест, що фіксує реальну послідовність викликів — масив рядків \['middleware','guard','interceptor:before','pipe','handler','interceptor:after'\].

**7\. Тести обов'язкові**

**Обмеження.** Дозволено: reflect-metadata, zod@4, node:async\_hooks, тест-раннер. Заборонено: @nestjs/\*, express, fastify.

**Підказки, які економлять години.** Чому не глобальна змінна: поки один запит чекає на await, event loop встигає обробити наступний і перезаписати глобал — до моменту логування там уже чужий id (та сама помилка, що на Лекції 2). als.run(store, callback) має обгортати **весь** обробник запиту, інакше глибокі виклики сховища не побачать. Guard проти interceptor одним реченням: guard відповідає «пускати чи ні» до всього і не може змінити відповідь, interceptor обгортає виклик і бачить і вхід, і вихід. Zod 4 має інший API помилок, ніж Zod 3: error.issues замість error.errors — більшість прикладів у мережі про третю версію. Exception filter має бути останнім у ланцюгу й ловити навіть те, що кинув interceptor: обгорніть весь цикл у try/catch на найвищому рівні. Тест на порядок пишіть першим — він задасть архітектуру й одразу покаже, якщо етап викликається не там.

**Acceptance criteria**

1.  \[ \] **Фреймворків немає.** grep -RE "@nestjs|express|fastify" package.json src/ не дає збігів.
2.  \[ \] **Порядок циклу зафіксовано тестом.** Є тест, що збирає масив міток і порівнює з очікуваною послідовністю **шести** етапів. Не «щось викликалось», а точний порядок.
3.  \[ \] **Guard блокує до обробника.** Запит без Authorization → 403, і тест доводить, що обробник **не** викликався (лічильник/спай).
4.  \[ \] **Interceptor міряє час.** У логах рядок із назвою маршруту й числом мілісекунд: grep -E "\[0-9\]+(\\.\[0-9\]+)? ?ms" по захопленому виводу.
5.  \[ \] **Pipe на Zod.** grep -rn "from 'zod'" src/ дає збіг; невалідне тіло → 400 зі списком полів.
6.  \[ \] **Exception filter ловить неочікуване.** Обробник кидає new Error('boom') → відповідь 500, і тіло не містить слова boom та стек-трейсу: відповідь не матчить /boom|at .\*\\.ts:/.
7.  \[ \] **Доменна помилка мапиться.** NotFoundError → 404 з осмисленим повідомленням.
8.  \[ \] **AsyncLocalStorage** **реально працює.** Сервіс, викликаний **на два рівні глибше** обробника, друкує той самий requestId, і в його сигнатурі немає параметра з id: grep -n "requestId" src/services/\*.ts — тільки читання зі сховища.
9.  \[ \] **X-Request-Id** **у відповіді.** curl -si localhost:3000/users/1 | grep -i x-request-id дає рядок; якщо клієнт надіслав свій — повертається саме він.
10.  \[ \] **Паралельні запити не змішують контексти.** Тест, що шле 10 одночасних запитів і перевіряє: жоден requestId не протік у чужу відповідь.
11.  \[ \] **Тести проходять.** npm test — код 0, щонайменше 10 пройдених тестів.
12.  \[ \] **Працює в Docker.** docker compose run --rm api npm test проходить.

**Формат здачі**

**Репозиторій:** той самий mini-nest, Pull Request із гілки part-3-lifecycle.

**Структура** (додається до частини 2):

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Файл</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">src/guards/auth.guard.ts</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">перевірка </span><span class="ql-bg-transparent ql-color-#188038">Authorization</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">src/interceptors/logging.interceptor.ts</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">вимірювання тривалості</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#188038">src/pipes/zod-validation.pipe.ts</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#000000">валідація на Zod 4</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#188038">src/filters/exception.filter.ts</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#000000">мапінг помилок у HTTP</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#188038">src/context/request-context.ts</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#000000">обгортка над </span><span class="ql-bg-transparent ql-color-#188038">AsyncLocalStorage</span></td></tr><tr><td data-row="7"><span class="ql-bg-transparent ql-color-#188038">test/lifecycle-order.test.ts</span></td><td data-row="7"><span class="ql-bg-transparent ql-color-#000000">тест на порядок етапів</span></td></tr><tr><td data-row="8"><span class="ql-bg-transparent ql-color-#188038">README.md</span></td><td data-row="8"><span class="ql-bg-transparent ql-color-#000000">діаграма циклу + абзац «чому ALS, а не глобальна змінна»</span></td></tr></tbody></table>

**Вимога до README:** діаграма життєвого циклу (можна ASCII) і абзац із поясненням, чому AsyncLocalStorage, а не глобальна змінна.

**У LMS здаєте посилання на PR**, не на головну гілку.

**Зв'язок з курсовим проєктом**

Це **фінальна форма training-артефакту**, поза курсовим проєктом. Готовий mini-Nest — це ~600 рядків, які пояснюють увесь NestJS.

Далі по курсу ви працюватимете вже зі справжнім Nest, але дивитиметеся на нього зсередини: @UseGuards — це ваш масив guard'ів, @UseInterceptors — ваша обгортка, exception filter — ваш try/catch на вершині.

AsyncLocalStorage із цього ДЗ прямо перевикористовується у Лекції 29 (Observability), де до requestId додасться OpenTelemetry-трасування.
