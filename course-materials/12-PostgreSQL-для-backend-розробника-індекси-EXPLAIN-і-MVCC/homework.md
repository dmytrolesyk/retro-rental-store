# PostgreSQL для backend-розробника: індекси, EXPLAIN і MVCC

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104318
Отримано: 2026-10-12T13:42:15.952Z

## Домашнє завдання

LMS ID: 54344

**Курсовий проєкт**: так (ДЗ №3 курсового проєкту)

Постановка

Ти проєктуєш дата-шар свого курсового проєкту (Marketplace API або твій домен) — і одразу доводиш, що він тримає навантаження. Це ДЗ — фундамент: схему, яку ти зафіксуєш зараз, ДЗ #13 переведе в TypeORM-міграції, ДЗ #14 навісить на неї транзакції, а ДЗ #15 — pooling і бекапи. Халтура тут коштуватиме переробок у чотирьох наступних роботах.

Стартова точка — твій compose з Postgres із ДЗ #5 (порт будь-який твій). Версія Postgres значення не має: драбинку лекції прогнано і на 16, і на 17 — вузли планів однакові. Схему проєктуй під user stories свого architecture-decision-record (HW 0); якщо його немає — час надолужити.

Що потрібно зробити

**1\. Схема —** **db/schema.sql**

Мінімум 4 таблиці твого домену (для Marketplace: users, products, orders, order\_items), зв'язки через FOREIGN KEY (мінімум 3), розумні типи (timestamptz, numeric для грошей — не float), NOT NULL/CHECK там, де брехня в даних недопустима. Схема застосовується на чисту базу однією командою без помилок.

**2\. Seed —** **db/seed.sql**

Реалістичний обсяг через generate\_series — **щонайменше 100 000 рядків у головній таблиці** (orders або аналог у твоєму домені) **і щонайменше стільки ж у тій таблиці, по якій шукатиме q4** (зазвичай products; якщо це одна й та сама таблиця — одного обсягу досить). На таблиці в тисячу рядків EXPLAIN не покаже нічого: планер справедливо вибере Seq Scan за будь-яких індексів. Розподіли значень роби перекошеними, як у житті (статуси не 33/33/33).

**Текстові поля, по яких шукає q4 (назва + опис), наливай українською.** Інакше обов'язкова частина «Українська» з пункту 4 не має на чому виконатись: на латиниці обидві словоформи дадуть по нулю, і ти не побачиш того, заради чого це завдання взагалі є.

Наприкінці — VACUUM (ANALYZE);.

**3\. Три повільні запити —** **db/queries/q1.sql****,** **q2.sql****,** **q3.sql**

Реальні запити твого API: пошук по власнику + період, фільтр по статусу, пошук без урахування регістру тощо. По одному statement на файл, без крапки з комою всередині. На свіжій схемі **без додаткових індексів** кожен мусить давати Seq Scan.

**4\. Четвертий запит — пошук по каталогу (****q4.sql****)**

Той самий конвеєр, що й у решти трьох: **запит → індекс → EXPLAIN до і після**. Різниця одна — індекс тут не B-tree.

_Запит._ Покупець вводить два-три слова, ти повертаєш до 20 карток товару. Один statement, без крапки з комою всередині:

SELECT id, name, ts\_rank(search\_vector, plainto\_tsquery('simple', 'шкіряні кросівки')) AS rank

FROM products

WHERE search\_vector @@ plainto\_tsquery('simple', 'шкіряні кросівки')

ORDER BY rank DESC, id

LIMIT 20

Слова підбери такі, щоб збігів було **одиниці відсотків** каталогу. Якщо запит чіпляє 30% рядків і більше — планер справедливо візьме Seq Scan навіть за живого індексу, і критерій «після індексів немає Seq Scan» завалить тебе за чужу провину.

_Індекс._ tsvector + GIN. Колонку роби генерованою — тоді її не треба підтримувати руками ні на INSERT, ні на UPDATE:

\-- у db/schema.sql, у визначенні таблиці або окремим ALTER:

ALTER TABLE products ADD COLUMN search\_vector tsvector

  GENERATED ALWAYS AS (to\_tsvector('simple', name || ' ' || description)) STORED;

\-- у db/indexes.sql:

CREATE INDEX idx\_products\_search\_vector ON products USING GIN (search\_vector);

Колонка живе в db/schema.sql — EXPLAIN «до» мусить її вже бачити, інакше в тебе не буде «до». Індекс — у db/indexes.sql. Expression-індекс без збереженої колонки (USING GIN (to\_tsvector('simple', name || ' ' || description))) приймається так само — тоді запит має повторювати рівно той самий вираз. pg\_trgm замість tsvector **не приймається**: він розв'язує іншу задачу (підрядок, а не слово), важчий на диску і будується в рази довше.

_Українська — обов'язкова частина завдання, а не примітка._ Візьми слово, яке твій пошук знаходить, і повтори пошук тим самим словом в іншому відмінку: «кросівки» → «кросівок», «сумка» → «сумок», «ноутбук» → «ноутбуків». Порахуй збіги обома формами:

SELECT count(\*) FROM products WHERE search\_vector @@ plainto\_tsquery('simple', 'кросівки');

SELECT count(\*) FROM products WHERE search\_vector @@ plainto\_tsquery('simple', 'кросівок');

Опиши результат у db/OPTIMIZATIONS.md секцією \## Морфологія: дві форми, два числа зі **своєї** бази, і одне речення — чому так. Куди дивитись за причиною: SELECT count(\*) FROM pg\_ts\_config; і \\dF у psql.

Полагодити це ДЗ **не вимагає** — вимагає побачити й назвати. Це найдорожче, що ти винесеш із завдання: воно пояснює, чому в маркетплейсі не можна просто «додати пошук», і чому підміна simple на russian — не фікс, а самообман.

**5\. Індекси —** **db/indexes.sql**

Мінімальний набір, що лікує всі чотири запити. **Щонайменше один — partial (****… WHERE …****) або expression (****… (lower(col))****)** — під запит, який без нього індекс ігнорує. Індекс під q4 — GIN по tsvector, він у цей мінімум не зараховується.

**6\. Звіт —** **db/OPTIMIZATIONS.md**

Для кожного запиту — повний вивід EXPLAIN (ANALYZE, BUFFERS) **до** і **після**, і по одному реченню: **який саме індекс став у вузол плану** (ім'я з db/indexes.sql — воно написане прямо у вузлі: Index Scan using … / Bitmap Index Scan on …), що змінилось у плані й чому (який вузол зник, куди поділись buffers). Плюс окрема секція \## Морфологія — див. пункт 4. Числа з твоєї машини; орієнтир прискорення — десятки разів, важливий порядок величини, не мілісекунди.

**7\. Підключення до БД — зі сховища ДЗ #11, без нових env-файлів**

Сховище вже підняте й працює, тому підключення застосунку до бази цього ДЗ живе там — в оточеннях dev і prod. Якщо на #11 ти завів DB\_URL — пункт у тебе вже виконаний: переконайся лише, що значення вказує на базу цього ДЗ і що в git не з'явився новий env-файл із рядком підключення. Якщо називаєш змінну DATABASE\_URL — додай її у ту саму zod-схему і в .env.example (пароль там фейковий), а джерело познач у таблиці «Configuration» README.

Дев-креденшели самого контейнера Postgres лишаються в docker-compose.yml як були: це два різні шляхи — застосунок бере секрет зі сховища, а грейдер піднімає локальний стенд зі свіжого клону.

**8\. Що зіпсує тобі вечір, якщо не знати заздалегідь**

**Підказки, які економлять години.**

Порядок перевірки в тебе локально = порядок грейдера: чистий volume → schema.sql → seed.sql → EXPLAIN «до» (Seq Scan) → indexes.sql → ANALYZE → EXPLAIN «після». Прожени цей цикл сам від docker compose down -v && docker compose up -d --wait до останнього EXPLAIN.

**Закінчуй** **seed.sql** **не** **ANALYZE;****, а** **VACUUM (ANALYZE);****.** ANALYZE дає планеру статистику, але visibility map виставляє саме VACUUM; без неї Index Only Scan усе одно лізе в таблицю (Heap Fetches: 12345 у плані), і твої buffers «після» будуть у сотні разів гірші, ніж могли б. На лекційній драбинці ця різниця — 12 сторінок проти ~2050 на тому самому запиті.

**Перший виклик q4 після** **CREATE INDEX** **— холодний.** GIN ще не в кеші, і число буде в десятки разів гірше за справжнє. Прожени запит 2–3 рази й бери останній.

**Вимога «≥100 000 рядків» стосується і таблиці пошуку.** У products типово насівають 200 рядків «щоб було що показати». На каталозі в 100–500 товарів різниці не буде **жодної**: планер візьме Seq Scan і до індексу, і після нього, бо на сотні рядків це чесно дешевше за похід у індекс. Ти зробиш усе правильно й не побачиш ефекту.

Якщо після індексу планер усе одно бере Seq Scan — перечитай крок 6 демо лекції: або selectivity зависока (умова відсікає замало рядків — зміни запит на реалістичніший), або в WHERE стоїть функція, а індекс — по колонці.

Якщо **q4** після GIN усе одно бере Seq Scan — перевір по черзі три речі: скільки рядків у таблиці пошуку (count(\*) має бути ≥100 000), скільки збігів дає запит (count(\*) по тій самій умові — має бути одиниці відсотків), і чи прогнав ти EXPLAIN більше одного разу.

random() у seed дає різні дані щоразу — це нормально, критерії від цього не залежать. Головне — перекіс розподілу і обсяг.

Гроші — numeric, час — timestamptz, «але ж serial простіший» — див. «Don't Do This» зі списку матеріалів.

Не індексуй «про запас»: кожен зайвий індекс — диск + повільніший INSERT. Це окремий критерій («Жоден твій індекс не лишився мертвим»), тож перевіряй себе **під час** роботи, а не в кінці: SELECT indexrelname, idx\_scan FROM pg\_stat\_user\_indexes WHERE schemaname='public' AND indexrelid NOT IN (SELECT conindid FROM pg\_constraint WHERE conindid <> 0) ORDER BY idx\_scan;. Без фільтра по pg\_constraint цей запит друкує ще й PK/UNIQUE-індекси з нулем сканів — вони нормальні, і через цей шум легко не помітити свій мертвий індекс.

**Збережена** **tsvector****\-колонка не безкоштовна.** Вона роздуває таблицю приблизно вдвічі й помітно сповільнює вставку — і це нормальна ціна, яку ти маєш уміти назвати вголос. Заміряй сам: pg\_total\_relation\_size('products') до додавання колонки і після.

  

Acceptance criteria

Грейдер виконує рівно ці команди на чистій базі — свіжий клон, без доступу до твого сховища (psql = будь-який спосіб дістатись твого Postgres; docker compose exec db psql -U app -d shop теж годиться).

**Доступ грейдера — це вже вкусило б після ДЗ #11.** У ДЗ #11 ти свідомо прибрав .env і secrets/db\_password з git. Грейдер цього ДЗ клонує гілку hw-12 **начисто** й піднімає базу командою з твого README — тобто гадати пароль йому нізвідки. Тому:

• у репозиторії має лежати \*.example (напр. secrets/db\_password.example) або дефолтні **дев**\-креденшели прямо в docker-compose.yml;

• у README — рівно один рядок «підняти базу» і рівно один рядок «підключитись», які працюють на свіжому клоні без правок файлів.

Перевір це сам, а не «мабуть, працює»: git clone --branch hw-12 <твій-репо> /tmp/check && cd /tmp/check → команда підняття з README → psql … -Atc "SELECT 1" має віддати 1.

☐ **Схема застосовується з нуля.** psql -f db/schema.sql завершується без ERROR, і psql -Atc "SELECT count(\*) FROM information\_schema.table\_constraints WHERE constraint\_type='FOREIGN KEY' AND table\_schema='public';" виводить **3 або більше**.

☐ **Seed наливає обсяг.** psql -f db/seed.sql завершується без ERROR, psql -Atc "SELECT count(\*) FROM <головна таблиця>;" виводить **100000 або більше**, і те саме для **таблиці, по якій іде q4** (обидві назви вкажи в README; якщо це одна таблиця — одного числа досить).

☐ **До індексів — Seq Scan.** Для кожного з **чотирьох** запитів psql -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/qN.sql)" (до застосування db/indexes.sql) містить рядок Seq Scan.

☐ **Після індексів — індексний план, і в ньому саме твій індекс.** Після psql -f db/indexes.sql і psql -c "ANALYZE;" той самий EXPLAIN для кожного з **чотирьох** запитів **не містить** Seq Scan і містить індексний вузол, у якому **названо ім'я індексу з твого** **db/indexes.sql**: Index Scan using <ім'я>, Index Only Scan using <ім'я> або Bitmap Index Scan on <ім'я>. Самих слів «Index Scan» мало — план міг піти по сусідньому індексу, а твій лишиться мертвим (див. наступний критерій). Для q4 прожени EXPLAIN 2–3 рази й бери останній: перший після CREATE INDEX іде по холодному GIN.

☐ **Жоден твій індекс не лишився мертвим.** Після того, як усі чотири EXPLAIN «після» прогнані, psql -Atc "SELECT indexrelname FROM pg\_stat\_user\_indexes WHERE schemaname='public' AND idx\_scan = 0 AND indexrelid NOT IN (SELECT conindid FROM pg\_constraint WHERE conindid <> 0);" дає **порожній вивід**. Будь-яке надруковане ім'я — це індекс, який ти створив, а жоден із чотирьох запитів ним не скористався: або він зайвий, або запит під нього не підходить. Підзапит по pg\_constraint відсікає індекси під PRIMARY KEY / UNIQUE: вони тримають констрейнт, а не запити, і нуль сканів для них нормальний. Лічильник рухає тільки EXPLAIN (ANALYZE, …) — плановий EXPLAIN без ANALYZE виконання не робить і лишає idx\_scan = 0 при живому індексі.

☐ **Partial або expression присутній.** Після psql -f db/indexes.sql psql -Atc "SELECT count(\*) FROM pg\_indexes WHERE schemaname='public' AND indexdef NOT ILIKE '%USING gin%' AND (indexdef ILIKE '% WHERE %' OR indexdef ~ '\\((\\w+)\\(');" виводить **1 або більше**. Перевірка читає **каталог**, а не текст файлу, тому не має значення, у скільки рядків ти записав CREATE INDEX (звичайні й складені індекси, у т.ч. з DESC NULLS LAST, сюди не потрапляють). GIN-індекси виключені навмисно: інакше expression-варіант FTS-індексу (GIN (to\_tsvector(…))) сам собою закривав би цей критерій, і партіал під q1–q3 можна було б не писати взагалі.

☐ **Звіт існує і повний.** grep -c 'Execution Time' db/OPTIMIZATIONS.md виводить **8 або більше** (4 пари до/після).

☐ **Пошуковий індекс — це GIN по tsvector.** Після psql -f db/indexes.sql psql -Atc "SELECT count(\*) FROM pg\_index i JOIN pg\_class c ON c.oid=i.indexrelid JOIN pg\_am am ON am.oid=c.relam JOIN pg\_opclass o ON o.oid=i.indclass\[0\] WHERE am.amname='gin' AND o.opcintype='tsvector'::regtype;" виводить **1 або більше**. Перевірка читає **каталог**, тому збережена генерована колонка і expression-індекс GIN (to\_tsvector(…)) проходять однаково, а GIN … gin\_trgm\_ops — ні: у нього вхідний тип text. Не переписуй цю перевірку через pg\_attribute: для GIN там лежить **тип зберігання** (text), а не тип колонки, — і вона дасть **0** при живому й робочому індексі.

☐ **Морфологію названо.** sed -n '/\[Мм\]орфолог/,/^#/p' db/OPTIMIZATIONS.md | grep -oE '\[0-9\]+' | wc -l виводить **2 або більше** — тобто секція «Морфологія» існує і в ній є щонайменше два числа (збіги базовою формою і збіги іншим відмінком, зняті на твоїй базі). Змістовну частину грейдер читає очима: дві форми, два числа, одне речення про причину.

☐ **Свіжий клон піднімається.** У порожній теці git clone --branch hw-12 <репо> . → команда підняття бази з README → psql -Atc "SELECT 1" виводить **1**. Жодних правок файлів руками.

☐ **Підключення застосунку — у сховищі, а не в новому env-файлі.** Жоден трекнутий env-файл, окрім .env.example, не містить змінної підключення — for f in $(git ls-files | grep -E '\\.env($|\\.)' | grep -vE '\\.example$'); do grep -lE '^(DATABASE\_URL|DB\_URL)=' "$f"; done → **порожній вивід** (будь-який надрукований шлях = провал). При цьому сама змінна присутня в контракті: grep -cE '^(DATABASE\_URL|DB\_URL)=' .env.example → **1 або більше** (пароль фейковий), а в таблиці «Configuration» README навпроти неї стоїть джерело — сховище. Назву змінної бери свою з README: DB\_URL з ДЗ #11 годиться так само, як DATABASE\_URL. Перевірка дивиться на env-файли, а не на docker-compose.yml: дев-креденшели стенда під неї не підпадають — вони не секрет і потрібні грейдеру для свіжого клону.

Формат здачі

Репозиторій: той самий репозиторій курсового проєкту, Pull Request з гілки hw-12.

<table><tbody><tr><td data-row="1"><strong class="ql-bg-transparent ql-color-#262626">Файл</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#262626">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-color-#2e7d32 ql-bg-transparent">db/schema.sql</span></td><td data-row="2"><span class="ql-color-#262626 ql-bg-transparent">таблиці, констрейнти, генерована </span><span class="ql-color-#2e7d32 ql-bg-transparent">tsvector</span><span class="ql-color-#262626 ql-bg-transparent">-колонка</span></td></tr><tr><td data-row="3"><span class="ql-color-#2e7d32 ql-bg-transparent">db/seed.sql</span></td><td data-row="3"><span class="ql-color-#262626 ql-bg-transparent">генерація даних (≥100 000 рядків) + </span><span class="ql-color-#2e7d32 ql-bg-transparent">VACUUM (ANALYZE)</span></td></tr><tr><td data-row="4"><span class="ql-color-#2e7d32 ql-bg-transparent">db/queries/q1.sql</span><span class="ql-color-#262626 ql-bg-transparent">, </span><span class="ql-color-#2e7d32 ql-bg-transparent">q2.sql</span><span class="ql-color-#262626 ql-bg-transparent">, </span><span class="ql-color-#2e7d32 ql-bg-transparent">q3.sql</span></td><td data-row="4"><span class="ql-color-#262626 ql-bg-transparent">реальні запити API — по одному statement на файл</span></td></tr><tr><td data-row="5"><span class="ql-color-#2e7d32 ql-bg-transparent">db/queries/q4.sql</span></td><td data-row="5"><span class="ql-color-#262626 ql-bg-transparent">повнотекстовий пошук по каталогу</span></td></tr><tr><td data-row="6"><span class="ql-color-#2e7d32 ql-bg-transparent">db/indexes.sql</span></td><td data-row="6"><span class="ql-color-#262626 ql-bg-transparent">усі індекси оптимізації, включно з GIN під q4</span></td></tr><tr><td data-row="7"><span class="ql-color-#2e7d32 ql-bg-transparent">db/OPTIMIZATIONS.md</span></td><td data-row="7"><span class="ql-color-#262626 ql-bg-transparent">4 пари EXPLAIN до/після + пояснення + секція </span><span class="ql-color-#2e7d32 ql-bg-transparent">## Морфологія</span></td></tr><tr><td data-row="8"><span class="ql-color-#2e7d32 ql-bg-transparent">README.md</span></td><td data-row="8"><span class="ql-color-#262626 ql-bg-transparent">як підняти Postgres, як прогнати всі кроки, назва головної таблиці </span><strong class="ql-bg-transparent ql-color-#262626">і</strong><span class="ql-color-#262626 ql-bg-transparent"> назва таблиці пошуку; джерело змінної підключення в таблиці «Configuration»</span></td></tr></tbody></table>

  

Грейдер має відтворити все на чистому volume **без правок файлів**.

У LMS здаєш **посилання на PR**, не на головну гілку.

Зв'язок з курсовим проєктом

Це **ДЗ №3** проєктної лінії: воно додає у твій Marketplace API (або обраний домен) **фундамент дата-шару** — схему, констрейнти, seed, докази швидкості під обсягом і робочий пошук по каталогу. Пошук тут закривається наполовину — Postgres-half; де закінчується Postgres і навіщо люди беруть окремий пошуковий рушій, розберемо на лекції #15.

Наступні кроки спираються саме на неї: ДЗ #13 (ORM) бере цю саму схему в TypeORM-entities та міграції, ДЗ #14 будує на ній транзакційну бізнес-логіку, ДЗ #15 — pooling/бекапи, ДЗ #16 — integration-тести проти реального Postgres.
