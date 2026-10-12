# API design: REST, OpenAPI, idempotency і contract testing

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104315
Отримано: 2026-10-12T13:41:23.350Z

## Домашнє завдання

LMS ID: 54342

Це перше ДЗ курсового проєкту. Перш ніж писати ендпойнти — ви **проєктуєте контракт**: OpenAPI-спеку свого Marketplace API (або обраного домену). Мета — щоб рішення з лекції (cursor-пагінація, Idempotency-Key, problem+json) стали не «знаннями», а задокументованими правилами вашого API, які перевіряє машина.

ДЗ складається з двох частин, і це не випадково:

Пункти 1–4: openapi.yaml      → ОБІЦЯНКА

                                        (сама по собі нічого не примушує)

Пункт 5:  Pact / OpenAPI-валідатор → ТОЙ, ХТО ЗВІРЯЄ

                                        (відхиляє все, що спеці суперечить)

Спека сама по собі нічого не примушує — на відміну від схеми відповіді у Fastify з Лекції 4, яка компілювалась у серіалізатор і фізично різала зайве. Пункт 5 — це той, хто звіряє: або консюмер декларує очікування (Pact), або валідатор на кордоні відхиляє все, що спеці суперечить. Спека без пункту 5 — красивий файл, який почне брехати після першого рефакторингу.

Стартова точка — репозиторій курсового проєкту, гілка hw-09.

Що потрібно зробити

1\. Спека openapi/openapi.yaml

OpenAPI 3.0.x, описи УКР або АНГЛ — на ваш вибір. Щонайменше **два ресурси** (наприклад, /products і /orders) і **пʼять операцій** сумарно. Кожна операція — з operationId, summary і описаними відповідями **включно з помилками**.

2\. Cursor-пагінація

На списковій операції: query-параметри limit і cursor, відповідь — обʼєкт з items та next\_cursor (nullable; null = сторінок більше немає). Курсор — **непрозорий токен**, у описі параметра так і напишіть.

3\. Idempotency-Key

На POST-операції створення: header-параметр, обовʼязково required: true — так валідатор зможе його вимагати. У description — семантика повтору: той самий ключ + те саме тіло → та сама відповідь.

4\. problem+json як контракт помилок

Кожна 4xx-відповідь у спеці — content: application/problem+json зі схемою Problem у components.schemas:

  

<table><tbody><tr><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Поле схеми </strong><strong class="ql-bg-transparent ql-color-#188038">Problem</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">type</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">URI типу помилки</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">title</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">коротка назва</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#188038">status</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#000000">HTTP-код</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#188038">detail</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#000000">що саме пішло не так</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#188038">instance</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#000000">посилання на конкретний випадок</span></td></tr></tbody></table>

5\. Contract-частина — ОДИН із двох варіантів

Обидва рівноцінні, обирайте будь-який:

  

<table><tbody><tr><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Варіант</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Що робите</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Що на виході</strong></td></tr><tr><td data-row="2"><strong class="ql-bg-transparent ql-color-#000000">А — consumer-driven Pact</strong></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">тест консюмера (</span><span class="ql-bg-transparent ql-color-#188038">@pact-foundation/pact</span><span class="ql-bg-transparent ql-color-#000000">) хоча б на одну взаємодію (наприклад, </span><span class="ql-bg-transparent ql-color-#188038">GET /orders/{id}</span><span class="ql-bg-transparent ql-color-#000000">): очікування декларуються, «код фронта» ганяється проти mock-провайдера</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">контракт-файл у </span><span class="ql-bg-transparent ql-color-#188038">pacts/</span></td></tr><tr><td data-row="3"><strong class="ql-bg-transparent ql-color-#000000">Б — runtime-валідація на кордоні</strong></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">мінімальний сервер (Express/Nest), де </span><span class="ql-bg-transparent ql-color-#188038">express-openapi-validator</span><span class="ql-bg-transparent ql-color-#000000"> валідує запити й відповіді проти вашої спеки, а error-handler перекладає його помилки у problem+json; достатньо 2–3 ендпойнтів зі спеки з in-memory даними</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">працюючий застосунок, який відхиляє все, що суперечить спеці</span></td></tr></tbody></table>

  

Provider verification і broker для варіанта А **НЕ** потрібні — це Лекція 16.

6\. Перевірки обовʼязкові

**Обмеження.** Усі критерії прогнані на чернетці 07.08.2026 на цих версіях: @redocly/cli 2.46.0, express 4.22.2, express-openapi-validator 5.6.2, @pact-foundation/pact 17.1.0. Кожен критерій — це команда, яку можна виконати й подивитись на результат.

**Підказки, які економлять години.** Гроші — цілі копійки (total\_cents: integer), не float: рядок-decimal "2600.00" — це біль v1 з лекції, не повторюйте його у своїй v1. nullable: true — це OpenAPI 3.0; якщо пишете 3.1 — там type: \[string, "null"\], Redocly підкаже, якщо змішаєте. У варіанті Б беріть express@4 — з ним express-openapi-validator працює без сюрпризів. Валідатор вимагає header-параметри у lowercase у req.headers, але в спеці пишіть як заведено: Idempotency-Key — саме тому в його detail побачите 'idempotency-key' з маленької. Якщо в package.json стоїть "type": "module", приклади з require(...) впадуть із ReferenceError: require is not defined in ES module scope: або переводьте застосунок на import, або називайте файл app.cjs. Не покладайтесь на те, що сервер «сам не віддасть зайвого» — саме тому в ДЗ і є пункт 5: у варіанті Б цю роль виконує validateResponses: true (на чернетці варто було перейменувати в хендлері total\_cents → totalCents, як той самий GET /orders/1 віддав 500 із detail: "/response must have required property 'total\_cents'" — це рантайм-аналог того contract/check.mjs, який на лекції ловив DRIFT=1). І не описуйте у спеці те, чого не будете робити: пʼять чесних операцій кращі за двадцять вигаданих — наступні ДЗ будуватимуться саме по цій спеці.

Додатковий виклик (без балів)

Для варіанта Б — повна семантика ключа, як на лекції: повтор того самого ключа + тіла → той самий 201 + заголовок Idempotency-Replay: true; той самий ключ з іншим тілом → 422 problem+json.

Acceptance criteria

1.  ![без прапорця](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Спека валідна.** npx @redocly/cli lint openapi/openapi.yaml завершується з exit code 0 (warnings дозволені, errors — ні). Підказка: redocly-правило security-defined закривається явним security: \[\] на корені — авторизації в API поки свідомо немає. (Перевірено: без цього рядка та сама спека дає exit 1 і Error was generated by the security-defined rule.)
2.  ![без прапорця](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Обсяг спеки витримано.** Щонайменше **2 ресурси** і **5 операцій**. Перевірка двома командами:

npx @redocly/cli bundle openapi/openapi.yaml -o spec.json

node -e "const s=require('./spec.json'),M=\['get','post','put','patch','delete'\];\\

const ops=Object.entries(s.paths).flatMap((\[p,v\])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>\[p,m\]));\\

const idem=ops.flatMap((\[p,m\])=>s.paths\[p\]\[m\].parameters??\[\]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\\

console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')\[1\])).size);\\

console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"

\# очікуємо: операцій ≥ 5 · ресурсів ≥ 2 · required = true · опис ≥ 40 символів

1.  ![без прапорця](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Idempotency-Key задекларовано.** grep -c 'Idempotency-Key' openapi/openapi.yaml ≥ 1, і в POST-операції це header-параметр із required: true. Оскільки стандарту на цей заголовок **немає** (IETF-draft expired, див. матеріали), у description параметра має бути описана семантика повтору — це і перевіряє «опис ≥ 40 символів» вище.
2.  ![без прапорця](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Cursor-пагінація у контракті.** grep -c 'next\_cursor' openapi/openapi.yaml ≥ 1; спискова операція має query-параметри cursor і limit, схема відповіді містить items + next\_cursor (nullable).
3.  ![без прапорця](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**problem+json скрізь у помилках.** grep -c 'application/problem+json' openapi/openapi.yaml ≥ 2; у components.schemas є Problem з обовʼязковими type/title/status/detail/instance.
4.  ![без прапорця](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Contract-частина працює — варіант А.** Команда тестів із README (наприклад, node --test consumer.pact.test.mjs) завершується з exit 0 і створює файл pacts/\*.json (перевірка: ls pacts/\*.json). На чернетці вийшло marketplace-web-marketplace-api.json з однією взаємодією.
5.  ![без прапорця](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Contract-частина працює — варіант Б.** Після npm start: запит POST /orders **без** Idempotency-Key → 400 із Content-Type: application/problem+json (заголовок вимагає спека, а не if у коді); запит із невалідним тілом (порожній items) → 400 із деталлю від валідатора; валідний запит → 201. На чернетці валідатор дав рівно такі detail:

request/headers must have required property 'idempotency-key'

request/body/items must NOT have fewer than 1 items

1.  ![без прапорця](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAA1ElEQVR4Ae3bMQ4BURSFYY2xBuwQ7BIkTGxFRj9Oo9RdkXn5TvL3L19u+2ZmZmZmZhVbpH26pFcaJ9IrndMudb/CWadHGiden1bll9MIzqd79SUd0thY20qga4NA50qgoUGgoRJo/NL/V/N+QIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIEyFeEZyXQpUGgUyXQrkGgTSVQl/qGcG5pnkq3Sn0jOMv0k3Vpm05pmNjfsGPalFyOmZmZmdkbSS9cKbtzhxMAAAAASUVORK5CYII=)**Усе працює після чистої установки.** Усі команди з criteria проходять після npm install — без ручних кроків, не описаних у README.

  

Формат здачі

Репозиторій курсового проєкту, Pull Request із гілки hw-09.

**Структура:**

  

<table><tbody><tr><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Файл / тека</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">openapi/openapi.yaml</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">спека: 2 ресурси, 5 операцій, cursor-пагінація, Idempotency-Key, problem+json</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">pacts/</span><span class="ql-bg-transparent ql-color-#000000"> + тест-файл</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">контракт-файл і тест консюмера (</span><strong class="ql-bg-transparent ql-color-#000000">варіант А</strong><span class="ql-bg-transparent ql-color-#000000">)</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#188038">app</span><span class="ql-bg-transparent ql-color-#000000"> із валідатором</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#000000">сервер з </span><span class="ql-bg-transparent ql-color-#188038">express-openapi-validator</span><span class="ql-bg-transparent ql-color-#000000"> (</span><strong class="ql-bg-transparent ql-color-#000000">варіант Б</strong><span class="ql-bg-transparent ql-color-#000000">)</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#188038">README.md</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#000000">яким варіантом ішли + команди запуску/перевірки</span></td></tr></tbody></table>

  

**Вимога до README:** явно вказати обраний варіант (А чи Б) і навести команди запуску та перевірки — усі команди з acceptance criteria мають працювати після npm install.

У LMS здаєте **посилання на PR**, не на головну гілку.

  

Звʼязок з курсовим проєктом

Це ДЗ №1 курсового: спека стає **джерелом правди** вашого Marketplace API.

По її ресурсах ви спроєктуєте схему БД (#12) та entities (#13), transactional-логіка оформлення замовлення (#14) реалізує задекларований тут POST з Idempotency-Key, а contract-частина виросте в integration/E2E-suite (#16).

Що чесніше спроєктуєте зараз — то менше переробок у наступні три місяці.
