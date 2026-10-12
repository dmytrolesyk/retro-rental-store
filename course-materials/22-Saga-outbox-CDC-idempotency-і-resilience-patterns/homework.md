# Saga, outbox, CDC, idempotency і resilience patterns

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104328
Отримано: 2026-10-12T13:45:08.117Z

## Домашнє завдання

LMS ID: 54352

Постановка

У ДЗ #12–13 ти спроектував схему курсового і підняв над нею ORM, у ДЗ #14 зробив ключову бізнес-операцію транзакційною, у ДЗ #16 покрив її тестами. Все це трималось на одному припущенні: весь ефект операції живе в одній базі. Сьогодні воно ламається. Щойно операція має ще й повідомити зовнішній світ (черга, інший сервіс, вебхук) — спільного COMMIT між базою і брокером не існує, і між двома записами зʼявляється проміжок, у який вміщається падіння процесу.

Ти закриваєш цей проміжок transactional outbox-ом і оплачуєш рахунок, який за цим приходить, — ідемпотентністю ефекту.

**⚠️ Головна вимога ДЗ — показати обидва боки «фейлу запису».** Це не одне демо, а два, і плутати їх не можна:

1.  **(а)** **demo:crash-write****.** Що падає: бізнес-запис — транзакція валиться вже ПІСЛЯ вставки рядка в outbox. Що має статись: подія не виходить назовні взагалі, обидва рядки зникають разом.
2.  **(б) ⭐** **demo:crash-relay****.** Що падає: службовий запис published\_at — процес relay помирає рівно МІЖ publish і UPDATE. Що має статись: подія публікується вдруге, а ефект лишається один.

(б) — це серце ДЗ. Воно доводить, що твоя доставка at-least-once, а exactly-once ти отримуєш не від брокера, а від ідемпотентного ефекту.

Що робиш:

**1\. Таблиця outbox — міграцією (не** **synchronize****).** Набір полів із лекції — aggregate\_type, aggregate\_id, type, payload jsonb, created\_at, published\_at (NULL = ще не винесено), attempts; плюс частковий індекс WHERE published\_at IS NULL під relay. Ролі полів — ті самі, що читає Debezium Outbox Event Router, тому пізніший перехід на CDC не переписує консюмерів. ⚠️ Дрібний шрифт: канонічні імена в Debezium — без підкреслень (aggregatetype, aggregateid), і саме aggregatetype стоїть у route.by.field за замовчуванням. Snake\_case доведеться або перейменувати, або явно перевизначити (route.by.field, table.field.event.key). Імена колонок — на твій розсуд: якщо твоя ORM робить publishedAt замість published\_at — це нормально, жоден критерій не дивиться на імена колонок (див. рамку перед acceptance).

**2\. Критична бізнес-операція пише подію в тій самій транзакції.** Обери ОДНУ операцію свого домену (для Marketplace — оформлення замовлення) і зроби так, щоб бізнес-рядок і рядок outbox комітились одним COMMIT. Ніякого publish усередині транзакції: брокер не вміє відкочуватись. У payload кладеш свідомо спроектований контракт події, а не ORM-сутність як є, — інакше схема твоєї БД стає публічним API, і перше ж перейменування колонки ламає всіх консюмерів.

**3\. Relay-воркер на polling.** SELECT … WHERE published\_at IS NULL ORDER BY created\_at, id FOR UPDATE SKIP LOCKED LIMIT N → publish → UPDATE published\_at. Саме SKIP LOCKED, а не голий FOR UPDATE: на лекції видно, що FOR UPDATE дає 0 дублів ціною нуля паралельності.

**4\. Ідемпотентний консюмер — два рівні.**

1.  **Рівень 1 (природний ключ):** сам ефект висловлений так, що повтор нічого не змінює — INSERT … ON CONFLICT DO NOTHING за природним ключем бізнес-операції (а не UPDATE qty = qty - 1, який на другій доставці зніме вдвічі).
2.  **Рівень 2 (inbox):** таблиця processed\_messages (message\_id, consumer), і позначка про обробку та сам ефект — в ОДНІЙ транзакції. Позначити в Redis, а ефект записати в Postgres — це знову dual write, тільки в профіль.

**5\. Ключ ідемпотентності на API-краю (рівень 3).** Той самий Idempotency-Key з ДЗ #9, тепер із серверною механікою: два однакові запити з тим самим ключем дають одне замовлення. Ключ ідентифікує намір, а не тіло: хеш тіла схлопнув би два легітимні однакові замовлення в одне.

**6\. Три демо-скрипти з фіксованими іменами** (щоб грейдер не вгадував): demo:outbox, demo:crash-write, demo:crash-relay. Кожен: (1) сам приводить стан до чистого, (2) друкує підсумок рядками ключ=число, (3) сам перевіряє інваріант і завершується з кодом ≠ 0, якщо той порушено.

**7\. Секрети — зі сховища ДЗ #11, нових env-файлів не заводимо.** Підключення до бази вже лежить у сховищі з ДЗ #12, доступ до брокера — теж туди. Три нові npm-скрипти ходять у базу, тому починаються з bash scripts/with-secrets.sh dev … — рівно як migrate/seed із ДЗ #13. Аварійний вхід SKIP\_VAULT=1 уже в твоїй обгортці, дописувати нічого не треба.

**8\. README-секція «Outbox та ідемпотентність»** з власними числами трьох прогонів, і окремим абзацом — відповідь на питання «чому не можна просто поміняти місцями publish і UPDATE published\_at».

**Контракт виводу демо (це і є те, що читає грейдер)**

Один рядок = ключ=число, ключі ASCII, у будь-якому порядку, зайві рядки дозволені.

1.  demo:outbox — requests orders outbox published deliveries effect processed
2.  demo:crash-write — write-failed orders outbox published deliveries effect
3.  demo:crash-relay — published deliveries applied effect processed

effect — скільки разів ефект фактично застосовано (відкинуті як дублі не рахуються). Якщо одна подія у твоєму домені породжує кілька рядків — зведи effect до кількості застосованих подій, а не рядків.

**Про брокер**

Брокер — інструмент, а не предмет ДЗ. Підійде будь-що, що є окремим від Postgres процесом: RabbitMQ/Kafka з твого compose, HTTP-ендпойнт сусіднього сервісу або власний стенд на node:http. Критерії не дивляться, що саме там стоїть, — вони дивляться на числа доставок і ефектів. Єдина вимога: брокер має бути іншим процесом, інакше «два менеджери ресурсів» перетворюються на один і все ДЗ втрачає сенс.

Змінну з адресою брокера в блоці \## Grading пиши під свій брокер — схема й порт мають збігатися: amqp://user:pass@host:5672 для RabbitMQ (5672 — це AMQP, по HTTP він не відповідає; 15672 — це вебморда менеджменту), host:9092 для Kafka, [) — якщо брокер у тебе власний на node:http. Жоден із девʼяти критеріїв цю змінну не читає, але грейдер копіює блок дослівно, тож неробоча пара «схема + порт» коштуватиме тобі зайвого раунду листування.

Збірка — tsc. Стартова точка — репозиторій курсового з ДЗ #16.

Acceptance criteria

**🔐 Сховище + грейдер — так само, як на ДЗ #13/#14.** Команди, що ходять у базу, усередині загорнуті в scripts/with-secrets.sh, а сховища у грейдера немає. Тому діє те саме правило: грейдер запускає з SKIP\_VAULT=1, а значення бере з дев-креденшелів твого docker-compose.yml. Розділ \## Grading у README має бути дописаний під це ДЗ — приблизно так:

cd services/api        # ← тільки якщо сервіс лежить у підкаталозі

docker compose up -d --wait

export DATABASE\_URL=postgres://app:app@127.0.0.1:5432/shop # або твої DB\_\*

export BROKER\_URL=amqp://app:app@127.0.0.1:5672       # ← ПРИКЛАД для RabbitMQ

export SKIP\_VAULT=1      # у грейдера немає доступу до сховища

npm ci

\--wait обовʼязковий (та сама вимога, що в ДЗ #11/#13/#14): без нього скрипт стартує раніше, ніж Postgres починає приймати зʼєднання, і падає з Error: connect ECONNREFUSED.

**📁 Де лежить package.json.** Команди грейдер запускає з того каталогу, де лежить твій package.json; пошукові критерії (5, 6, 8, 9) — з кореня репо. Розкладка «сервіс у підкаталозі» перевірена окремо і проходить усі 9 критеріїв — за умови, що перший рядок \## Grading це cd <тека сервісу>.

**🔎 Критерії перевіряють ПОВЕДІНКУ, а не форму.** Жоден критерій не дивиться на імена таблиць, імена колонок і не грепає числові літерали. publishedAt замість published\_at, UUID замість bigserial, TypeORM замість сирого SQL, Prisma замість TypeORM — усе це проходить. Ловиться рівно те, що ДЗ і обіцяє: подія не може вижити без бізнес-запису, доставка at-least-once, ефект — один.

☐ **1\. Компіляція чиста:** npm ci && npx tsc --noEmit завершується без помилок.

☐ **2\. Happy path + ключ ідемпотентності на API-краю:** npm run demo:outbox завершується з exit 0 і друкує requests=2, orders=1, outbox=1, published=1, effect=1, processed=1. Два запити з тим самим Idempotency-Key дали одне замовлення, одну подію, один ефект.

npm run demo:outbox | tee /tmp/o.txt; echo "exit=${PIPESTATUS\[0\]}"

for k in requests=2 orders=1 outbox=1 published=1 effect=1 processed=1; do

  grep -qx "$k" /tmp/o.txt || echo "НЕМАЄ: $k"

done

☐ **3\. Фейл бізнес-запису не випускає подію назовні:** npm run demo:crash-write завершується з exit 0 і друкує write-failed=1, orders=0, outbox=0, published=0, deliveries=0, effect=0. Транзакція впала вже після вставки рядка в outbox — і рядок зник разом із замовленням. Це доказ, що записи справді в одному COMMIT, а не в двох.

☐ **4\. ⭐ Подія публікується вдруге після фейлу службового запису:** npm run demo:crash-relay завершується з exit 0, друкує deliveries ≥ 2 і при цьому applied=1, effect=1, processed=1. Тобто: та сама подія доставлена щонайменше двічі, а ефект застосовано рівно один раз.

npm run demo:crash-relay | tee /tmp/c.txt; echo "exit=${PIPESTATUS\[0\]}"

awk -F= '/^deliveries=/{ok=($2>=2)} END{exit !ok}' /tmp/c.txt && echo "deliveries>=2 OK"

for k in applied=1 effect=1 processed=1; do

  grep -qx "$k" /tmp/c.txt || echo "НЕМАЄ: $k"

done

Як саме вбити relay — на твій розсуд, обидві форми легальні: справжній kill -9 дочірнього процесу (як крок 4 у коді лекції) або змодельований обрив — виняток чи ROLLBACK рівно в тій самій точці (як крок 8 у коді лекції). Напиши в README, що обрав. Критерій навмисно не вимагає конкретної форми: він перевіряє наслідок, а не спосіб.

☐ **5\. SKIP LOCKED справді в коді relay:**

grep -rniE --include='\*.ts' --exclude-dir=node\_modules --exclude-dir=dist "skip\[ \_-\]\*locked" .

дає щонайменше один збіг. Патерн \[ \_-\]\* навмисно вільний — він ловить і сирий SKIP LOCKED, і TypeORM setOnLocked('skip\_locked'), і skipLocked().

☐ **6\. Дедуп зроблено через конфлікт, а не через SELECT-потім-INSERT:**

grep -rniE --include='\*.ts' --exclude-dir=node\_modules --exclude-dir=dist \\

  "on\[ \_\]\*conflict|do\[ \_\]+nothing|or\[ \_\]\*ignore|skip\[ \_\]\*duplicates|ignore\[ \_\]\*duplicates|23505|P2002" .

дає щонайменше один збіг. Патерн перевірений на 12 легальних формах: сирий ON CONFLICT DO NOTHING (у тому числі з переносом рядка і з подвійним пробілом), TypeORM .orIgnore() і .onConflict(...), Prisma skipDuplicates і код P2002, код 23505 від pg. ⚠️ Це допоміжна статична перевірка: вона показує, що інструмент узагалі застосований. Справжній доказ ідемпотентності — критерій 4, і саме він ловить консюмера без дедупу.

☐ **7\. Демо ходять у базу через обгортку зі сховищем:**

node -e "const s=require('./package.json').scripts;const bad=\['demo:outbox','demo:crash-write',

'demo:crash-relay'\].filter(k=>/with-secrets\\.sh/.test(s\[k\]||'')===false);console.log(bad.length===0

?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)"

друкує OK і завершується з exit 0. Перевірка статична — ані сховища, ані бази не потребує. Якщо обгортка не в самому скрипті, а в скрипті, який він викликає, — винеси її в сам скрипт: критерій дивиться на рядок демо-скрипта.

☐ **8\. У README є розділ** **\## Grading****:**

grep -rlE '^#{1,3} +Grading' --include='README.md' --exclude-dir=node\_modules . | wc -l

друкує ≥ 1. Без цього розділу грейдер на свіжому клоні не запустить жодного з трьох демо.

☐ **9\. Жодного трекнутого env-файла з живим рядком підключення:**

for f in $(git ls-files | grep -E '(^|/)\\.env($|\\.)' | grep -vE '\\.(example|sample|template|dist)$'); do

  grep -lE '=(amqps?|postgres(ql)?|redis|https?)://\[^ \]\*:\[^ @\]+@' "$f"

done

дає порожній вивід. Значення приходять зі сховища ДЗ #11. Файл-контракт зі змінними (.env.example, .env.sample, .env.template) — не порушення навіть якщо в ньому стоїть URL-подібний плейсхолдер: він відсіяний фільтром за розширенням, і це перевірено окремо на обох іменах.

Формат здачі

1.  Той самий репозиторій курсового проєкту, гілка hw-22 + Pull Request.
2.  Структура (у корені або у своєму каталозі сервісу):

<table><tbody><tr><td data-row="1"><strong class="ql-bg-transparent ql-color-#1a1a1a">Файл</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#1a1a1a">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#1a1a1a">міграція</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#1a1a1a">таблиці </span><span class="ql-bg-transparent ql-color-#1a7f4b">outbox</span><span class="ql-bg-transparent ql-color-#1a1a1a"> і </span><span class="ql-bg-transparent ql-color-#1a7f4b">processed_messages</span><span class="ql-bg-transparent ql-color-#1a1a1a"> + частковий індекс </span><span class="ql-bg-transparent ql-color-#1a7f4b">WHERE published_at IS NULL</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#1a1a1a">код бізнес-операції</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#1a1a1a">бізнес-рядок і рядок outbox одним </span><span class="ql-bg-transparent ql-color-#1a7f4b">COMMIT</span><span class="ql-bg-transparent ql-color-#1a1a1a">; обробка </span><span class="ql-bg-transparent ql-color-#1a7f4b">Idempotency-Key</span><span class="ql-bg-transparent ql-color-#1a1a1a"> на API-краю</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#1a1a1a">relay-воркер</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#1a7f4b">FOR UPDATE SKIP LOCKED</span><span class="ql-bg-transparent ql-color-#1a1a1a"> → publish → </span><span class="ql-bg-transparent ql-color-#1a7f4b">UPDATE published_at</span><span class="ql-bg-transparent ql-color-#1a1a1a"> (саме в цьому порядку)</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#1a1a1a">ідемпотентний консюмер</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#1a1a1a">ефект через природний ключ + позначка в </span><span class="ql-bg-transparent ql-color-#1a7f4b">processed_messages</span><span class="ql-bg-transparent ql-color-#1a1a1a"> в одній транзакції</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#1a1a1a">три демо-скрипти</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#1a1a1a">самоочисні, друкують </span><span class="ql-bg-transparent ql-color-#1a7f4b">ключ=число</span><span class="ql-bg-transparent ql-color-#1a1a1a">, самі перевіряють інваріант і повертають код ≠ 0</span></td></tr><tr><td data-row="7"><span class="ql-bg-transparent ql-color-#1a7f4b">package.json</span></td><td data-row="7"><span class="ql-bg-transparent ql-color-#1a1a1a">npm-скрипти </span><span class="ql-bg-transparent ql-color-#1a7f4b">demo:outbox</span><span class="ql-bg-transparent ql-color-#1a1a1a">, </span><span class="ql-bg-transparent ql-color-#1a7f4b">demo:crash-write</span><span class="ql-bg-transparent ql-color-#1a1a1a">, </span><span class="ql-bg-transparent ql-color-#1a7f4b">demo:crash-relay</span><span class="ql-bg-transparent ql-color-#1a1a1a"> — усі три через </span><span class="ql-bg-transparent ql-color-#1a7f4b">scripts/with-secrets.sh</span></td></tr><tr><td data-row="8"><span class="ql-bg-transparent ql-color-#1a7f4b">README.md</span></td><td data-row="8"><span class="ql-bg-transparent ql-color-#1a1a1a">секція «Outbox та ідемпотентність» з власними числами + оновлений розділ </span><span class="ql-bg-transparent ql-color-#1a7f4b">## Grading</span></td></tr></tbody></table>

  

Грейдер має підняти все командами з acceptance criteria без правок файлів.

У LMS здаєш **посилання на PR**.

Підказки, які економлять години

1.  Порядок publish → UPDATE published\_at міняти не можна. Якщо спершу позначити винесеним, а потім публікувати, відмова publish дасть «позначили, але не віддали» — тобто втрату. Вибір тут не між «добре» і «погано», а між дублем і втратою. Дубль лікується дедуплікацією, втрата не лікується нічим.
2.  Помилка publish не означає, що повідомлення не доставлено — загубитись могла відповідь брокера. Тому «зловив помилку → відкотив → все чисто» не працює: подія вже може бути в черзі. Саме через це дедуп на консюмері обовʼязковий незалежно від того, наскільки акуратний твій relay.
3.  Позначка в processed\_messages і ефект мусять бути в одній транзакції. Дві окремі транзакції — це той самий dual write, від якого ти тікав, тільки перенесений на консюмера.
4.  Жоден ORDER BY у relay не гарантує порядку доставки: SKIP LOCKED розкидає рядки між воркерами, тож сортування задає лише порядок вибірки. Порядок існує лише в межах ключа партиціонування — якщо він тобі потрібен, скажи про це в README явно. Сортувати за самим id ненадійно ще й з наступної причини ↓
5.  bigserial видає номер на nextval, а видимим рядок стає на COMMIT — тому «взяти всі id більші за останній оброблений» пропускає рядки. Це головна причина, чому в relay стоїть published\_at IS NULL, а не курсор по id.
6.  Транзакція живе на одному клієнті з пулу: pool.connect() або dataSource.transaction(...), а не pool.query('BEGIN') — інакше BEGIN і COMMIT поїдуть у різні зʼєднання, і «одна транзакція» виявиться фікцією.
7.  Таблиця outbox росте і гальмує той самий частковий індекс, від якого залежить relay. Мінімум — рядок у README про те, як ти її чиститимеш.
8.  Не пиши в payload ORM-сутність через spread. Зроби явну функцію toOrderPlacedEvent(order) — це три рядки зараз і врятований контракт потім.

Зв'язок з курсовим проєктом

Це десятий крок проєктної лінії. Він стоїть на схемі з ДЗ #12–13 і транзакційній логіці з ДЗ #14: та сама операція, яку ти вже зробив атомарною всередині бази, тепер стає атомарною разом зі своїм повідомленням назовні. Тестовий каркас із ДЗ #16 нікуди не дівається — demo:crash-relay природно переїжджає в integration-тест на testcontainers.

Далі: ДЗ #23 покладе поверх цієї ж події Redis і чергу BullMQ — і там окремо проговоримо, що розподілений лок не замінює ідемпотентність. Напрямок росту, який у ДЗ не входить: замінити polling-relay на CDC (Debezium + Outbox Event Router) — саме тому таблицю ми одразу заводимо в канонічній формі.

І головне, що варто винести з цього ДЗ у резюме й на співбесіду: exactly-once доставки не існує — це задача двох генералів. Існує at-least-once доставка плюс ідемпотентний ефект, і разом вони дають exactly-once результат. Kafka дає EOS усередині себе (read-process-write між своїми топіками); щойно на іншому кінці твоя база — гарантія знову зводиться до твого ключа дедуплікації. Твій demo:crash-relay — це рівно те місце, де це видно очима.
