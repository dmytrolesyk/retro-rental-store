# Transactions і SQL optimization у реальних сценаріях

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104320
Отримано: 2026-10-14T15:16:14.987Z

## Домашнє завдання

LMS ID: 54346

У ДЗ #12 ти спроектував схему курсового проєкту, у ДЗ #13 підняв над нею TypeORM. Тепер — головний тест дорослості data-layer: що станеться, коли твій endpoint викличуть 50 разів одночасно. Ти реалізуєш ключову бізнес-операцію свого домену (для Marketplace — оформлення замовлення: декремент stock + списання балансу + запис order) так, щоб вона переживала конкурентний шквал без oversell і втрачених апдейтів, і додаєш воркер-пул, який розбирає чергу задач через FOR UPDATE SKIP LOCKED.

Стартова точка — репозиторій курсового з ДЗ #13 (entities + міграції). Нові таблиці (черга задач) додаєш **міграцією**, не synchronize. Збірка — tsc; сирий SQL можна виконувати через dataSource.query() або pg — на твій розсуд.

Що потрібно зробити

**1\. Транзакційний checkout**

Операція «оформити замовлення» виконується в **одній транзакції**: декремент stock, списання балансу покупця, INSERT замовлення, INSERT задачі на post-processing (лист/чек — сама задача виконується окремо, п. 3). Захист від oversell — атомарний UPDATE … SET stock = stock - $n WHERE … AND stock >= $n RETURNING або SELECT … FOR UPDATE (вибір обґрунтуй у README одним абзацом). Недостатньо коштів або товару → транзакція відкочується ціла: замовлень-«сиріт» не існує.

**2\. Скрипт конкурентного навантаження — npm run demo:race**

Щонайменше **50 паралельних викликів** checkout (Promise.all, без черг у застосунку) на один товар зі stock = 10, по одній одиниці за виклик. Баланси покупців у сіді свідомо надлишкові — обмежувати має саме stock, інакше число успішних стане випадковим. Скрипт друкує: кількість спроб, кількість успішних, фінальний stock, кількість рядків із відʼємним stock — і сам перевіряє інваріант (exit code ≠ 0, якщо oversell стався).

**3\. Воркер-пул через SKIP LOCKED — npm run demo:workers**

**≥ 2 воркери** (у межах одного процесу — Promise-и, або кілька процесів — на твій вибір) розбирають задачі з таблиці черги запитом … FOR UPDATE SKIP LOCKED. Кожна задача обробляється рівно один раз (лічильник processed у рядку задачі); скрипт друкує розподіл задач по воркерах, кількість оброблених двічі та загальний час.

**4\. Retry-патерн — npm run demo:retry**

Сценарій, що провокує serialization failure (наприклад, два конкурентні read-modify-write під REPEATABLE READ), і обгортка, яка ловить **тільки** коди 40001/40P01, повторює транзакцію цілком із backoff і логує кожен повтор. Фінальний стан — арифметично коректний.

**5\. README-секція «Конкурентність»**

Числа зі своїх запусків (успішних із 50, час воркерів, кількість retry), вибір pessimistic vs atomic UPDATE, чому retry ловить лише два коди.

**6\. Підключення до БД — зі сховища ДЗ #11, без нових env-файлів**

DATABASE\_URL/DB\_URL уже лежить у сховищі з ДЗ #12, а параметри ORM ти брав звідти в ДЗ #13. Тут потрібне рівно одне: нові npm-скрипти теж ходять у базу, тож demo:race, demo:workers і demo:retry починаються з bash scripts/with-secrets.sh dev … — так само, як migrate і seed у ДЗ #13. Це нуль додаткової роботи (обгортка написана на ДЗ #11) і рівно те, що дозволяє грейдеру запускати команди без жодних префіксів.

Аварійний вхід SKIP\_VAULT=1, який ти додав в обгортку на ДЗ #13, тут працює без змін — нічого дописувати не треба. Твоє сховище грейдеру так само недоступне, тому розділ \## Grading у README (теж із ДЗ #13) має покривати й нові демо: див. рамку перед acceptance.

**7\. Що зіпсує тобі вечір, якщо не знати заздалегідь**

**Підказки, які економлять години.**

Транзакція живе на **одному** клієнті з пулу: const c = await pool.connect() (або dataSource.transaction(...)), а не pool.query('BEGIN') — інакше BEGIN і COMMIT поїдуть у різні зʼєднання.

UPDATE … WHERE stock >= $n RETURNING повертає 0 рядків = товару нема. Це і перевірка, і лок одночасно — жодного вікна для гонки.

50 паралельних клієнтів — це 50 одночасних зʼєднань. Або підніми max у пулі, або чекай, поки вони чемно постоять у черзі пулу (це нормально і на результат не впливає).

У воркері тримай транзакцію відкритою на час обробки задачі: впав воркер до COMMIT — лок зник, задачу підбере інший. Статус done і результат комітяться разом.

SKIP LOCKED із порожнім результатом означає «вільних немає **зараз**», не «черга порожня» — перепитай, перш ніж завершувати воркер.

Retry повторює транзакцію **з початку**, включно з читаннями. Повтор тільки запису — це той самий lost update у профіль.

Через TypeORM обидва інструменти доступні з QueryBuilder: setLock('pessimistic\_write') — це FOR UPDATE, setOnLocked('skip\_locked') — це SKIP LOCKED. Сирий SQL через dataSource.query() усередині тієї самої транзакції теж дозволений — критерії написані так, щоб проходили обидва шляхи.

Acceptance criteria

Грейдер виконує рівно ці команди у корені твого репо — свіжий клон, чиста БД, без доступу до твого сховища. База піднімається як docker compose up -d --wait, далі — твої migrate/seed з ДЗ #13.

🔐 **Сховище + грейдер — так само, як на ДЗ #13.** Команди, що ходять у базу, всередині загорнуті в scripts/with-secrets.sh, а сховища у грейдера немає: на свіжому клоні npm run demo:race одразу падає з Please either run infisical init to connect to a project…, exit 1. Тому діє те саме правило, що й на ДЗ #13: грейдер запускає команди з SKIP\_VAULT=1 (аварійний вхід уже є в твоїй обгортці), а значення DB\_\*/DATABASE\_URL бере з дев-креденшелів твого docker-compose.yml. Розділ \## Grading у README має бути дописаний під це ДЗ — рівно такі рядки, наприклад:

docker compose up -d --wait

export DATABASE\_URL=postgres://app:app@127.0.0.1:5432/shop # або твої DB\_\*

export SKIP\_VAULT=1    # у грейдера немає доступу до сховища

\--wait обовʼязковий (та сама вимога, що в ДЗ #11 і ДЗ #13): без нього на свіжому томі скрипт стартує раніше, ніж Postgres починає приймати зʼєднання, і падає з Error: Connection terminated unexpectedly. Те, що основний шлях усе-таки веде у сховище, перевіряє статичний останній критерій — йому не потрібні ані сховище, ані база.

📁 **Де лежить package.json.** Команди вище грейдер запускає з того каталогу, де лежить твій package.json. Якщо весь сервіс у підкаталозі (services/api/package.json, services/api/package-lock.json, services/api/src/…) — це легально, але перший рядок розділу \## Grading має бути cd services/api, інакше npm ci впаде з npm error code EUSAGE, а npm run demo:race — з Could not read package.json. Розкладка «джерела в підкаталозі, package.json у корені» працює без жодних додаткових рядків.

Пошукові критерії шукають по всьому репо (а не тільки в кореневому src/) — щоб розкладка «сервіс у підкаталозі» з розділу «Формат здачі» проходила так само, як розкладка з src/ у корені. Їх грейдер запускає з кореня репо. Лапки навколо '\*.ts' обовʼязкові: без них zsh зʼїсть зірочку ще до grep.

☐ **Компіляція чиста.** npm ci && npx tsc --noEmit завершується без помилок.

☐ **Гонка без oversell.** npm run demo:race завершується з кодом 0 і друкує: спроб ≥ 50, успішних рівно 10 (= початковий stock при qty = 1), фінальний stock 0, рядків із відʼємним stock 0.

☐ **Атомарність під капотом.** grep -rniE --include='\*.ts' --exclude-dir=node\_modules --exclude-dir=dist "for update|returning|pessimistic\_write" . дає збіг у коді checkout (лок або атомарний UPDATE — не read-modify-write у JS). Три альтернативи в патерні — бо FOR UPDATE через QueryBuilder виглядає в коді як setLock('pessimistic\_write').

☐ **Воркер-пул чесний.** npm run demo:workers завершується з кодом 0 і друкує «оброблено двічі: 0», розподіл по ≥ 2 воркерах і час, менший за послідовний (N задач × тривалість однієї).

☐ **SKIP LOCKED справді використано.** grep -rniE --include='\*.ts' --exclude-dir=node\_modules --exclude-dir=dist "skip\[ \_\]locked" . дає щонайменше один збіг у коді воркера. Клас символів \[ \_\] — бо сирий SQL пише SKIP LOCKED, а TypeORM — setOnLocked('skip\_locked').

☐ **Retry працює.** npm run demo:retry друкує щонайменше один пійманий 40001 або 40P01 із повтором і фінальний стан, що сходиться арифметично (скрипт сам перевіряє і завершується з кодом 0). У коді retry-обгортки — перевірка коду помилки: grep -rniE --include='\*.ts' --exclude-dir=node\_modules --exclude-dir=dist "40001|40P01" . дає збіг.

☐ **Демо ходять у базу через сховище.** Обгортка з ДЗ #11 зашита всередину npm-скриптів — node -e "const s=require('./package.json').scripts;const bad=\['demo:race','demo:workers','demo:retry'\].filter(k=>/with-secrets\\.sh/.test(s\[k\]||'')===false);console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)" друкує OK і завершується з exit 0. Перевірка статична — працює на свіжому клоні й без доступу до твого сховища.

Формат здачі

Репозиторій: той самий репозиторій курсового проєкту, Pull Request з гілки hw-14.

Структура (у корені або у своєму каталозі сервісу):

<table><tbody><tr><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Файл</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#000000">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#0b8043">src/</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">checkout-операція, воркер, retry-обгортка</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#0b8043">src/migrations/</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">нова міграція для таблиці черги задач</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#0b8043">package.json → scripts</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#0b8043">build</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#0b8043">demo:race</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#0b8043">demo:workers</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#0b8043">demo:retry</span><span class="ql-bg-transparent ql-color-#000000"> — три останні через </span><span class="ql-bg-transparent ql-color-#0b8043">scripts/with-secrets.sh</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#0b8043">README.md → «Конкурентність»</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#000000">числа зі своїх запусків + два обґрунтування (п. 5)</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#0b8043">README.md → ## Grading</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#0b8043">docker compose up -d --wait</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#0b8043">export DATABASE_URL=…</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#0b8043">export SKIP_VAULT=1</span><span class="ql-bg-transparent ql-color-#000000">, за потреби </span><span class="ql-bg-transparent ql-color-#0b8043">cd &lt;тека сервісу&gt;</span></td></tr></tbody></table>

Без розділу \## Grading грейдер на свіжому клоні не запустить жодного з трьох демо.

Грейдер має підняти все командами з acceptance criteria **без правок файлів**.

У LMS здаєш **посилання на PR**, не на головну гілку.

Зв'язок з курсовим проєктом

Це **ДЗ №5 проєктної лінії** (mapping «Як проєкт збирається з ДЗ» у spec.md): додає transactional бізнес-логіку поверх схеми з ДЗ #12–13, не змінюючи джерела секретів — підключення як приїжджало зі сховища з ДЗ #11, так і приїжджає.

Наступні кроки спираються саме на неї: ДЗ #15 підключить PgBouncer під цей самий навантажувальний скрипт, ДЗ #16 покриє checkout integration-тестами на testcontainers, а в L#19/#22 черга задач еволюціонує в RabbitMQ + transactional outbox.
