# Docker для Node.js: від dev-середовища до базового production-stack

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104311
Отримано: 2026-10-12T13:40:14.925Z

## Домашнє завдання

LMS ID: 54338

**Постановка**

Ви пакуєте у контейнер той самий сервіс, який писали на Лекції 4 (Express або Fastify — байдуже), і піднімаєте його разом із Postgres однією командою.

Мета — не «навчитися Docker», а зрозуміти три речі, через які реальні образи важать 1.2 ГБ замість 180 МБ і падають у проді: як працює **кеш шарів**, навіщо **multi-stage** і чому контейнер **не повинен ходити під root**.

**Що потрібно зробити**

**1\. Dockerfile з multi-stage build**

Мінімум дві стадії:

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Стадія</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Що містить</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">builder</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">dev-залежності, збірка</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">runner</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">тільки production-залежності + артефакт збірки</span></td></tr></tbody></table>

У фінальний образ не потрапляють ні dev-залежності, ні вихідні .ts/тести.

**2\. Порядок шарів під кеш**

package\*.json копіюються й npm ci виконується **до** копіювання решти коду. Зміна одного рядка в src/ не повинна перезапускати встановлення залежностей.

**3\. Non-root**

Фінальна стадія перемикається на непривілейованого користувача (USER node в офіційному образі або власний через adduser). Процес у контейнері працює не від uid 0.

**4\. .dockerignore**

Мінімум: node\_modules, .git, Dockerfile, \*.md, .env. Без нього контекст збірки тягне сотні мегабайтів.

**5\. HEALTHCHECK**

У Dockerfile, б'є у ваш /health ендпойнт.

**6\. docker-compose.yml**

Два сервіси: ваш api і postgres:17. Postgres із іменованим volume (дані переживають docker compose down), api чекає на готовність БД через depends\_on + condition: service\_healthy.

**7\. docker-compose.override.yml для dev**

Пробрасує код у контейнер (bind mount), вмикає hot-reload, відкриває порт назовні. Базовий docker-compose.yml має лишатися придатним для CI **без** override.

**8\. README.md**

Команди запуску і — обов'язково — **розмір фінального образу** (docker images) поруч із розміром образу, зібраного «в лоб» з однієї стадії. Різницю поясніть одним реченням.

**Стартова точка.** Ваш сервіс із ДЗ/демо Лекції 4. Якщо його немає — підійде будь-який мінімальний Express/Fastify із двома ендпойнтами: GET /health і GET /users.

**Підказки, які економлять години.** Базовий образ — node:22-slim або node:24-slim: без суфікса це ~1.1 ГБ, slim — ~200 МБ (alpine менший, але musl іноді ламає нативні модулі). npm ci, а не npm install — він читає package-lock.json і не переписує його. depends\_on без condition: service\_healthy не чекає готовності Postgres. Секрети не через ENV — вони лишаються в шарах образу назавжди.

**Acceptance criteria**

1.  \[ \] **Multi-stage реальний.** grep -c '^FROM' Dockerfile виводить 2 або більше, і у фінальній стадії немає npm ci без \--omit=dev: grep -n 'npm ci' Dockerfile — у runner-стадії рядок містить \--omit=dev або \--only=production.
2.  \[ \] **Кеш шарів не ламається.** У Dockerfile рядок COPY package стоїть раніше за COPY . . — grep -n 'COPY' Dockerfile дає менший номер рядка для package.
3.  \[ \] **Non-root.** docker run --rm <image> id -u виводить значення ≠ 0. У Dockerfile присутній USER.
4.  \[ \] **.dockerignore існує** і містить щонайменше node\_modules та .git: grep -E 'node\_modules|\\.git' .dockerignore дає збіги.
5.  \[ \] **Healthcheck працює.** Після docker compose up -d команда docker inspect --format '{{.State.Health.Status}}' <api-container> через ~30 с виводить healthy.
6.  \[ \] **Стек піднімається однією командою.** docker compose up -d → curl -s -o /dev/null -w "%{http\_code}\\n" [http://localhost:3000/health](http://localhost:3000/health) виводить 200.
7.  \[ \] **Дані Postgres переживають перезапуск.** Створили таблицю → docker compose down (без \-v) → docker compose up -d → таблиця на місці. У README опишіть, якою командою це перевіряли.
8.  \[ \] **Override не потрібен для CI.** docker compose -f docker-compose.yml config відпрацьовує без помилок і не містить bind-mount на ./src: docker compose -f docker-compose.yml config | grep -c 'source: ./src' виводить 0.
9.  \[ \] **README містить обидва розміри образу** і речення-пояснення різниці.

**Формат здачі**

**Репозиторій:** публічний GitHub-репозиторій (або гілка hw-05 у наявному навчальному репо) + Pull Request.

**Структура:**

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Файл</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">Dockerfile</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">multi-stage, non-root, healthcheck</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">.dockerignore</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">виключає </span><span class="ql-bg-transparent ql-color-#188038">node_modules</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#188038">.git</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#188038">.env</span><span class="ql-bg-transparent ql-color-#000000"> тощо</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#188038">docker-compose.yml</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#000000">база, придатна для CI</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#188038">docker-compose.override.yml</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#000000">dev-режим: bind mount, hot-reload, порт</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#188038">src/</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#000000">сервіс із Лекції 4</span></td></tr><tr><td data-row="7"><span class="ql-bg-transparent ql-color-#188038">README.md</span></td><td data-row="7"><span class="ql-bg-transparent ql-color-#000000">команди запуску, розміри образів, як перевіряли persistence</span></td></tr></tbody></table>

**Вимога до README:** грейдер має підняти все командою docker compose up -d — без правок файлів.

**У LMS здаєте посилання на PR**, не на головну гілку.

**Зв'язок з курсовим проєктом**

Це **foundation-ДЗ поза курсовим проєктом**, але артефакт із нього ви носитимете через увесь курс.

Починаючи з Лекції 6 весь NestJS-код виконується **всередині цього контейнера**; на Лекціях 12–16 до compose додасться Postgres із міграціями, на 19–20 — черги, на 23 — Redis. Чим охайніше зробите зараз, тим менше переробок далі.

Production-grade Docker (BuildKit secrets, сканування, підпис образів) і Kubernetes — Лекція 28.
