# Integration, E2E та contract testing

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104322
Отримано: 2026-10-24T10:24:44.968Z

## Домашнє завдання

LMS ID: 54348

**Курсовий проєкт: так**

**Постановка**

Твій курсовий проект уже має data layer (ДЗ #13), транзакції (#14) і OpenAPI-спеку (#9). Час перестати вірити мокам: у цьому ДЗ ти будуєш integration suite проти справжнього Postgres у testcontainers, E2E happy path через supertest і один контрактний тест через Pact — з брокером і can-i-deploy у CI. Це та сама «драбинка довіри» з лекції, застосована до твого домену.

  

**Що робиш:**

**1\. Integration suite з testcontainers.**

Тести репозиторіїв (мінімум 2 репозиторії, по 3+ тести) проти postgres:16-alpine, який піднімає @testcontainers/postgresql прямо з тесту. Обовʼязково покрий те, чого мок не має: щонайменше один тест на unique/FK constraint і один на поведінку, що залежить від SQL (JOIN/агрегація/ON CONFLICT). Redis-залежності, якщо є, — опційно (глибоко буде у #23).

**2\. Ізоляція тестів.**

Обери стратегію свідомо (транзакція-ROLLBACK, TRUNCATE або контейнер-на-файл) і напиши в README 2-3 речення, чому саме вона. Вимога, що перевіряється: повторний запуск suite поспіль зелений без ручної чистки.

**3\. Test data builders.**

Мінімум один builder (aUser(), anOrder()...) з валідними унікальними дефолтами; тести не містять «стіни фікстур».

**4\. E2E happy path через supertest.**

Повний Nest-застосунок (Test.createTestingModule({ imports: \[AppModule\] }), без підмін провайдерів; БД — через env від testcontainer): наскрізний сценарій головної фічі твого проекту (створити → прочитати) плюс один негативний кейс (404 або 400 від ValidationPipe).

**5\. Contract-тест через Pact, який верифікує твою OpenAPI-спеку з ДЗ #9.**

Consumer-тест (уявний фронтенд) описує 1+ interaction з provider state → генерується pacts/\*.json; provider verification ганяє твій СПРАВЖНІЙ застосунок проти контракту зі stateHandlers, що сідять БД. Шлях і форма відповіді в interaction мають відповідати ендпойнту зі спеки #9.

**6\. Broker + can-i-deploy у CI.**

У compose курсового — сервіс pact-broker; CI-workflow отримує job contract: публікація контракту → provider verification з publishVerificationResult: true → крок can-i-deploy, який валить джобу, якщо deployable не true. Адреса й токен брокера — це секрети, а не константи в коді: локально вони живуть у сховищі з ДЗ #11 і приїжджають через ту саму обгортку (bash scripts/with-secrets.sh dev npm run verify:provider), у CI — через secrets GitHub. Код читає лише process.env.PACT\_BROKER\_URL / PACT\_BROKER\_TOKEN. Дефолт на [http://127.0.0.1:<порт>](http://127.0.0.1:\<порт\>) для локального compose — можна: це не секрет. DATABASE\_URL у тестах — окремий випадок і сховища не потребує: його видає testcontainer у рантаймі (container.getConnectionUri()), і саме в цьому сенс шару. Сховище лишається джерелом для звичайного запуску застосунку (віхи 3-4 курсового), а не для тестів.

**7\. npm-скрипти — фіксовані імена, щоб грейдер не вгадував:**

test:integration, test:e2e, test:contract (consumer), verify:provider.

**8\. reporters: \['default'\] у jest-конфізі.**

Один рядок, який робить вивід твоїх тестів однаковим у будь-якому середовищі запуску. Якщо reporters не заданий, Jest 30 вибирає репортер сам — за змінними оточення (список зашитий у detectAgent() в @jest/core), і в частині середовищ вмикає компактний репортер agent: той не друкує ні PASS <файл>, ні назв describe/it, ні ✓ — лишається сам підсумок Tests: N passed. console.log друкується в обох режимах. У звичайному терміналі, у npm run … | tee і в CI повний вивід є й без цього рядка — але ти не знаєш, звідки запускатимуть твою роботу, тому рядок обовʼязковий. Той самий рядок стоїть у jest.config.js лекції 16 і лекції 10.

Збірка — tsc (esbuild-транспілятори не емітять decorator-метадані). Порада з лекції: тримай maxWorkers: 1 дефолтом — кожен jest-воркер множить контейнери.

  

**Acceptance criteria**

Грейдер виконує рівно ці команди у корені твого репо (свіжий клон, Docker запущений):

☐ **Компіляція чиста:** npm ci && npx tsc --noEmit завершується без помилок.

☐ **Integration suite на testcontainers:** npm run test:integration завершується з exit 0 і друкує Tests: N passed (N ≥ 6: два репозиторії × 3 тести); контейнер піднімається з коду — grep -rn "PostgreSqlContainer" test/ src/ дає збіг. Серед тестів є constraint-кейс: grep -rniE "duplicate key|unique|2350\[0-9\]|foreign key|constraint" test/ src/ дає збіг (підходить і код помилки 23505/23503, і UNIQUE у DDL/ентіті, і текст помилки).

☐ **Репортер увімкнено:** grep -n "reporters" jest.config.\* (або секція jest у package.json) дає збіг із 'default', і у виводі npm run test:integration видно рядки PASS …. Рядок вимикає автовибір репортера в Jest 30 (див. п. 8 постановки): без нього в частині середовищ запуску зникають PASS, назви тестів і ✓, і решту критеріїв ніхто не побачить.

☐ **Ізоляція реальна:** npm run test:integration && npm run test:integration — обидва прогони зелені (без ручної чистки БД між ними).

☐ **E2E через supertest:** npm run test:e2e завершується з exit 0 і друкує Tests: N passed, де N ≥ 2 — happy path + негативний кейс. Що негативний кейс справді є, видно статично: grep -rnE "\\b(400|404|409|422)\\b|HttpStatus\\.(BAD\_REQUEST|NOT\_FOUND|CONFLICT|UNPROCESSABLE\_ENTITY)" test/e2e/ дає збіг. Форма запису — твоя: .expect(404), expect(res.status).toBe(404) або ідіоматичний для Nest enum .expect(HttpStatus.NOT\_FOUND) — патерн ловить усі три (цифрову форму курс не мандатує).

☐ **Contract-тест генерує контракт:** npm run test:contract зелений і створює pacts/\*.json (ls pacts/\*.json); у файлі є providerStates (grep providerStates pacts/\*.json).

☐ **Provider verification проходить:** npm run verify:provider завершується з exit 0 — справжній застосунок відповідає на всі interactions. Рядок верифаєра шукаємо зі знятими кольорами: npm run verify:provider 2>&1 | sed -E $'s/\\\\x1b\\\\\[\[0-9;\]\*m//g' | grep -F "has a matching body (OK)" дає збіг. (Pact фарбує OK ANSI-кодами, тому грепати has a matching body (OK) без sed — марно: збігів буде нуль навіть на ідеальному рішенні. Рівноцінна перевірка без sed — grep -F '"result":"OK"'.)

☐ **Контракт узгоджений зі спекою #9:** шлях кожного interaction збігається з якимось шляхом зі спеки, якщо порівнювати посегментно і вважати, що плейсхолдер зі спеки закриває будь-який конкретний сегмент (/orders/7 ↔ /orders/{id} ↔ /orders/{orderId} — імʼя параметра не має значення; так само проходять /orders/3fa85f64-… з UUID, /orders/01JB4Z0K9QH8Y3 з ULID і /products/blue-shirt зі slug — тип ідентифікатора курс не мандатує). Перевірка (замість <файл> — імʼя твого пакта, замість openapi.yaml — шлях до твоєї спеки):

node -e 'const p=require("./pacts/<файл>.json");const spec=require("fs").readFileSync("openapi.yaml","utf8");const sp=\[...spec.matchAll(/^\\s+(\\/\\S\*):\\s\*$/gm)\].map(m=>m\[1\]);const seg=s=>s.split("?")\[0\].replace(/\\/+$/,"").split("/");const fit=(a,b)=>{a=seg(a);b=seg(b);return a.length===b.length&&a.every((x,i)=>/^\\{\[^}\]+\\}$/.test(x)?b\[i\]!=="":x===b\[i\])};const bad=p.interactions.filter(i=>!sp.some(x=>fit(x,i.request.path)));console.log(bad.length?"НЕМАЄ У СПЕЦІ: "+bad.map(i=>i.request.path).join(", "):"OK");process.exit(bad.length?1:0)'

друкує OK і завершується з exit 0. Якщо шлях не знайдено — команда назве саме той, якого бракує. Порівняння свідомо посегментне, а не «згорнути числа в {}»: інакше єдиний законний UUID або slug в ідентифікаторі провалював би цілком коректну роботу.

☐ **Broker + can-i-deploy у CI:** .github/workflows/ містить job із кроками publish → verify → can-i-deploy (grep -rn "can-i-deploy" .github/workflows/ дає збіг), а YAML валідний (python3 -c "import yaml;yaml.safe\_load(open('.github/workflows/<файл>.yml'))").

☐ **Локальний еквівалент гейта відпрацьовує — обидві відповіді:** послідовність нижче показує гейт у роботі — спершу «не можна», потім «можна». Порядок кроків обовʼязковий, і крок 4 (тег prod) пропускати не можна: to=prod питає «чи є перевірений контракт із тією версією провайдера, що зараз у prod» — поки жодну версію провайдера не позначено як prod, чесна відповідь брокера завжди unknown, і deployable ніколи не стане true.

– docker compose up -d --wait — брокер healthy;

– publish контракту curl\-ом → 201;

– PACT\_BROKER\_URL=… npm run verify:provider → exit 0 (з publishVerificationResult: true). Це аварійна форма для грейдера: у нього немає доступу до твого сховища, тому значення передається змінною напряму. Твій основний шлях — той, що в п. 6 постановки: bash scripts/with-secrets.sh dev npm run verify:provider, і під SKIP\_VAULT=1 він виконує рівно цю ж команду. Обидві форми легальні, напиши в README, що є що;

– curl -X PUT "$PACT\_BROKER\_URL/pacticipants/<provider>/versions/<та сама версія провайдера>/tags/prod" -H 'Content-Type: application/json' → 201;

– curl "$PACT\_BROKER\_URL/can-i-deploy?pacticipant=<consumer>&version=<v>&to=prod" → у відповіді є "deployable":true.

Показати треба обидва стани: та сама команда 5, викликана між кроками 3 і 4, має дати "deployable":null і "unknown":1. Саме ця пара — «до тега unknown, після тега true» — і є доказ, що гейт справжній, а не завжди-зелений. Обидва виводи вклей у README.

☐ **Обгортка сховища на місці:** test -f scripts/with-secrets.sh && grep -q 'SKIP\_VAULT' scripts/with-secrets.sh завершується з exit 0. Це та сама обгортка з ДЗ #11 з аварійним входом із ДЗ #13 — саме через неї локально приїжджають PACT\_BROKER\_URL/PACT\_BROKER\_TOKEN (п. 6 постановки). Перевірка статична: ані сховища, ані бази не потребує.

☐ **Токен брокера не в репо:** grep -rnE "PACT\_BROKER\_TOKEN\[\[:space:\]\]\*\[:=\]\[\[:space:\]\]\*\['\\"\]\[^'\\"$\]" --include='\*.ts' --include='\*.js' --include='\*.yml' --include='\*.yaml' --include='\*.json' . | grep -v node\_modules дає порожній вивід — значення приходить зі сховища ДЗ #11 (локально) або з secrets GitHub (у CI). Локальний дефолт виду [http://127.0.0.1:<порт>](http://127.0.0.1:\<порт\>) для PACT\_BROKER\_URL — не порушення: це адреса твого ж compose, а не секрет.

  

**Формат здачі**

• Той самий репозиторій курсового проекту, гілка hw-16 + Pull Request.

• Структура (додається до наявної):

<table><tbody><tr><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Файл</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#2e7d32">test/integration/</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">тести репозиторіїв + testkit (контейнер, builders)</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#2e7d32">test/e2e/</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">supertest-сценарії</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#2e7d32">test/contract/</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#000000">consumer-тест і provider verification</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#2e7d32">pacts/</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#000000">згенерований контракт (можна в </span><span class="ql-bg-transparent ql-color-#2e7d32">.gitignore</span><span class="ql-bg-transparent ql-color-#000000">, якщо CI генерує сам — тоді напиши це в README)</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#2e7d32">.github/workflows/…</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#000000">job </span><span class="ql-bg-transparent ql-color-#2e7d32">contract</span></td></tr><tr><td data-row="7"><span class="ql-bg-transparent ql-color-#2e7d32">README.md</span></td><td data-row="7"><span class="ql-bg-transparent ql-color-#000000">розділ «Тестування»: команди, обрана стратегія ізоляції і чому, як підняти брокер локально</span></td></tr></tbody></table>

  

У LMS здаєш **посилання на PR**.

  

**Підказки, які економлять години**

• Репозиторій має приймати «щось з query()» (Pool або Client) — інакше стратегія ROLLBACK не підключиться.

• Незакритий пул = jest висить. await app.close() в afterAll і pool.end() обовʼязкові; діагностика — npx jest --detectOpenHandles.

• У healthcheck брокера в контейнері пиши 127.0.0.1, не localhost: localhost усередині може резолвитись у ::1, а puma слухає лише IPv4.

• stateHandlers сідять БД під provider state — використовуй INSERT … ON CONFLICT DO NOTHING, щоб верифікація була повторюваною.

• Матчери MatchersV3.like()/regex() замість точних значень — інакше контракт ламається від кожного нового запису.

• Конфігурацію застосунку (pipes, prefix) винеси у спільну функцію з main.ts — інакше E2E тестує інший застосунок, ніж прод.

• DEBUG=testcontainers\* вмикається спокусливо, але в CI його не став: бібліотека продовжує логувати вже після завершення тестів, jest ловить «Cannot log after tests are done» і повертає exit 1 при всіх зелених тестах. Для локальної діагностики — ок, для пайплайна — ні.

• Тег prod у брокері ставиться на версію провайдера, а не консюмера, і має збігатися з тим providerVersion, який ти передав у Verifier. Розбіжність — і can-i-deploy чесно скаже unknown.

  

**Звʼязок з курсовим проєктом**

Це ДЗ додає до твого Marketplace API (або обраного домену) шар довіри: інтеграційні тести data layer з #13-14, E2E головної фічі та контракт, що робить спеку з #9 виконуваною. Suite, який ти тут збереш, — основа для CI/CD у Лекції 32: там цей самий can-i-deploy стане обовʼязковим гейтом перед деплоєм, а тести — частиною pipeline. Черги (#19-20) і Redis (#23) підключатимуться до цього ж testcontainers-каркаса.
