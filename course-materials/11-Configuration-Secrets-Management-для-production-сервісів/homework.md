# Configuration & Secrets Management для production-сервісів

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104317
Отримано: 2026-10-12T13:41:58.211Z

## Домашнє завдання

LMS ID: 54343

**Курсовий проєкт:** так (ДЗ №2 курсового проєкту)

  

**Постановка**

Ти наводиш лад у конфігурації свого курсового проєкту (Marketplace API або твій обраний домен). Ціль — зламаний конфіг убиває застосунок **на старті** зі зрозумілою помилкою, а не на першому запиті в проді, і жоден секрет не живе ані в git, ані в шарах docker-образу:

process.env → zod-схема (fail-fast) → ConfigService<Env, true> → код

secrets/db\_password → password: () => readFile() → pg.Pool → БД

Фінальний акорд — ротація пароля БД **без рестарту** сервісу: саме це відрізняє «секрети як env» від «секрети як керований ресурс».

Стартова точка — поточний стан твого курсового проєкту.

  

**Що потрібно зробити**

**1\. Zod-схема env + fail-fast**

Усі змінні застосунку описані **однією** zod-схемою: required/optional, типи через z.coerce, дефолти. Схема виконується на старті через validate у ConfigModule.forRoot (як на лекції, крок 5) — зламана змінна означає: процес не стартує, у виводі назва змінної та причина, exit code ≠ 0. По коду існує тільки typed-конфіг ConfigService<Env, true>; прямих читань process.env поза схемою немає.

**2\. Конвенція** **.env.example**

Файл-контракт у git: кожна змінна зі схеми присутня, з коментарем, секретні значення — фейкові. Реальний .env — у .gitignore. Плюс npm-скрипт check:env, який звіряє .env.example зі схемою і падає з exit 1, якщо файл відстав (зразок — scripts/check-env-example.mjs у репо лекції).

**3\. Секрети поза git і поза образом**

.env ігнорується git-ом і не потрапляє в docker-образ (.dockerignore). Якщо в проєкту ще немає Dockerfile — додай мінімальний single-stage за зразком ДЗ #5.

**4\. Ротація DB-пароля без рестарту**

Пароль Postgres застосунок читає з **файла-секрета** (не з env), а в pg.Pool/DataSource пароль заданий **функцією**, що перечитує файл на кожне нове зʼєднання. Скрипт rotate.sh: ALTER ROLE → оновити файл → закрити старі зʼєднання (pg\_terminate\_backend). Після ротації сервіс відповідає далі, uptime не обнуляється. Зразок механіки — крок 7 репо лекції; свій Postgres піднімай у compose.

**5\. README — розділ «Configuration»**

Список змінних, як запустити, як виконати ротацію.

**6\. Що зіпсує тобі вечір, якщо не знати заздалегідь**

  

**Підказки, які економлять години.** z.coerce.number(), а не z.number() — усе, що приходить з env, є рядком. Скрипт start **не має бути watch-режимом**: nest start --watch (як і tsx watch) не завершується і не віддає exit code, тож перший критерій на такому скрипті не проходить механічно — роби "start": "npm run build && node dist/main.js", а watch тримай окремо (start:dev). Якщо у проєкті TypeScript і pg — потрібен @types/pg у devDependencies, інакше tsc падає з TS7016. validate у ConfigModule.forRoot викликається ДО створення DI-графа — кидай Error зі списком **усіх** зламаних змінних одразу, а не по одній. У pg поле password приймає async\-функцію — це і є «перечитати секрет на нове зʼєднання»; у TypeORM той самий ефект дає DataSource з динамічним отриманням пароля. Після pg\_terminate\_backend пул емітить 'error' — без pool.on('error', …) процес упаде: це не баг ротації, це відсутній обробник. Порядок у rotate.sh важливий: спершу ALTER ROLE, одразу потім файл (про вікно між ними і alternating users — у матеріалах, AWS rotation strategies). Стартове значення secrets/db\_password має збігатися з паролем з init.sql: після docker compose down -v Postgres повертається до стартового пароля, а файл лишається з ротованим — поверни файл, інакше password authentication failed.

  

**Acceptance criteria**

1.  ![unchecked](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Fail-fast працює.** Тимчасово прибери .env (mv .env /tmp) — інакше dotenv тихо підхопить змінну з файла — і запусти без обовʼязкової змінної (наприклад env -u DB\_URL npm run start): процес завершується з **exit code ≠ 0**, у виводі є назва зламаної змінної, echo $? показує не-нуль. Поверни файл: mv /tmp/.env ..
2.  ![unchecked](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**.env.example** **синхронний зі схемою.** npm run check:env → exit 0; після видалення будь-якого рядка з .env.example та сама команда → exit 1 (поверни рядок назад).
3.  ![unchecked](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Секрет не в git.** git check-ignore .env виводить .env, а git ls-files .env — порожньо. Одна команда замість двох: git status --ignored --porcelain | grep -E '^!! .\*\\.env$' має знайти рядок, а git ls-files | grep -c '\\.env$' — дати **0** (у git лежить лише .env.example).
4.  ![unchecked](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Секрет не в образі.** Збери образ (docker build -t myapp .) і перевір трьома командами: docker run --rm myapp ls -a /app — є .env.example, **немає** .env і теки secrets/; docker run --rm myapp sh -c 'cat /app/.env' 2>&1 — No such file or directory (**2>&1** **обовʼязково**: повідомлення йде у stderr, а контейнер виходить з кодом 1); docker inspect --format '{{.Config.Env}}' myapp — лише змінні базового образу (PATH, NODE\_VERSION, YARN\_VERSION), жодних паролів. Додатково docker history --no-trunc myapp | grep -i password має бути порожнім.
5.  ![unchecked](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Ротація без рестарту.** curl /health (запамʼятай uptime) → bash rotate.sh → запит, що ходить у БД, повертає 200, і uptime у /health **більший** за попередній — процес не перезапускався.

  

**Додатковий виклик (без балів)**

Переведи секрети проєкту в **Infisical** (self-host через docker compose або cloud): секрети живуть у проєкті Infisical, локальний запуск — через infisical run -- npm run start, .env для секретів більше не потрібен. Це той самий крок, який у продакшн-командах роблять після дозрівання «файлової» схеми.

Формат здачі

Репозиторій: той самий репозиторій курсового проєкту, Pull Request із гілки hw-11.

  

**Структура (додається поверх наявного проєкту):**

<table><tbody><tr><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Файл</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">src/config/env.schema.ts</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">zod-схема + </span><span class="ql-bg-transparent ql-color-#188038">validate</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">scripts/check-env-example.mjs</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">звірка </span><span class="ql-bg-transparent ql-color-#188038">.env.example</span><span class="ql-bg-transparent ql-color-#000000"> зі схемою (</span><span class="ql-bg-transparent ql-color-#188038">check:env</span><span class="ql-bg-transparent ql-color-#000000">)</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#188038">.env.example</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#000000">повний контракт змінних; </span><span class="ql-bg-transparent ql-color-#188038">.env</span><span class="ql-bg-transparent ql-color-#000000"> — у </span><span class="ql-bg-transparent ql-color-#188038">.gitignore</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#188038">secrets/db_password</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#000000">файл-секрет (у </span><span class="ql-bg-transparent ql-color-#188038">.gitignore</span><span class="ql-bg-transparent ql-color-#000000">)</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#188038">rotate.sh</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#000000">ротація пароля БД без рестарту</span></td></tr><tr><td data-row="7"><span class="ql-bg-transparent ql-color-#188038">docker-compose.yml</span></td><td data-row="7"><span class="ql-bg-transparent ql-color-#000000">Postgres для локального запуску</span></td></tr><tr><td data-row="8"><span class="ql-bg-transparent ql-color-#188038">Dockerfile</span><span class="ql-bg-transparent ql-color-#000000"> + </span><span class="ql-bg-transparent ql-color-#188038">.dockerignore</span></td><td data-row="8"><span class="ql-bg-transparent ql-color-#000000">образ без секретів у шарах</span></td></tr><tr><td data-row="9"><span class="ql-bg-transparent ql-color-#188038">README.md</span></td><td data-row="9"><span class="ql-bg-transparent ql-color-#000000">розділ «Configuration»</span></td></tr></tbody></table>

  

**Вимога до README:** список змінних, команда запуску та покроково — як виконати ротацію.

Грейдер перевіряє кожен критерій командами з цього файла, без правок твого коду.

У LMS здаєш **посилання на PR**, не на головну гілку.

Зв'язок з курсовим проєктом

Це ДЗ №2 курсового проєкту: конфіг-скелет, у який на Лекціях 12–13 сядуть DATABASE\_URL і міграції, на Лекції 23 — Redis, на Лекції 24 — JWT-ключі.

Схема env з цього ДЗ — єдина точка, куди всі наступні ДЗ додають свої змінні. Ротаційний патерн повернеться на Лекції 28 (K8s Secrets) і Лекції 31 (AWS).
