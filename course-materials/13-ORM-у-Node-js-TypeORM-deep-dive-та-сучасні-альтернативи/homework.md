# ORM у Node.js: TypeORM deep dive та сучасні альтернативи

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104319
Отримано: 2026-10-12T13:42:35.165Z

## Домашнє завдання

LMS ID: 54345

**Постановка**

У ДЗ #12 ти спроєктував схему БД для свого курсового проєкту: таблиці, зв'язки, індекси — чистим SQL. Тепер ця схема переїжджає в код: ти піднімаєш над нею TypeORM так, як це робиться у проді — entities + relations + міграції, без жодного synchronize: true.

І доводиш, що розумієш головну ціну ORM: знаходиш у своєму проєкті запит із N+1, показуєш його в лозі SQL і лікуєш.

  

**Що потрібно зробити**

**1\. Entities для всієї схеми з ДЗ #12**

Кожна таблиця — клас із @Entity(); типи колонок, @Index, nullable відповідають твоєму SQL-дизайну. Гроші — integer у мінорних одиницях, не float.

**2\. Relations**

Усі зв'язки схеми — через @OneToMany/@ManyToOne (і @OneToOne, де є). Для кожного FK — свідомий onDelete: де історію захищає RESTRICT, де діти йдуть за батьком через CASCADE.

Якщо у схемі є M:N із даними на зв'язку (кількість, ціна на момент, роль) — це явна join-entity, не @ManyToMany.

**3\. Міграції замість synchronize**

У DataSource — synchronize: false. Початкова схема створюється згенерованою міграцією (migration:generate), яку ти прочитав і, якщо треба, поправив руками. down() має реально відкочувати.

**4\. Seed**

Окремий скрипт із детермінованими даними (мінімум по 5–10 рядків в основних таблицях), ідемпотентний: другий запуск не дублює рядки і не падає.

**5\. N+1 демо + фікс**

Скрипт, що вмикає logging: \['query'\], виконує реальний для твого домену запит «список + зв'язки» спершу наївно (запит на елемент у циклі або lazy-поля), потім із фіксом (relations / leftJoinAndSelect), і друкує кількість SQL-запитів до і після. Числа заносиш у README.

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Стратегія</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Кількість запитів</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">наївно (запит у циклі)</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">≥ N (розмір колекції)</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#1a7f37">relations</span><span class="ql-bg-transparent ql-color-#000000"> / </span><span class="ql-bg-transparent ql-color-#1a7f37">leftJoinAndSelect</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">1</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#1a7f37">relationLoadStrategy: 'query'</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#000000">1 + 2 × (рівнів зв'язків): 3 на один рівень, 5 на два</span></td></tr></tbody></table>

  

**6\. QueryBuilder vs Repository**

Один звітний запит для твого домену (агрегат + GROUP BY + JOIN — «виторг по категоріях», «топ авторів», аналог), який неможливо виразити через find(): реалізуєш через createQueryBuilder().getRawMany().

Поруч у README — 2–3 речення: за яким критерієм у проєкті проводиш межу між Repository і QueryBuilder.

**7\. Параметри підключення — зі сховища ДЗ #11**

У data-source.ts немає ні зашитого хоста/пароля, ні читання нового env-файла: усі значення приходять із process.env, який наповнює infisical run.

Щоб команди викликались без жодних префіксів, обгортку ти ховаєш усередину самих npm-скриптів — усі, що ходять у базу (migrate, migrate:show, migrate:revert, seed, demo:nplus1, report), починаються з bash scripts/with-secrets.sh dev …. Форма фіксована: на migrate і seed спирається останній критерій. Коштує це нуль додаткової роботи — обгортка вже написана на ДЗ #11, лишається дописати префікс у scripts свого package.json.

**8\. Аварійний вхід для грейдера — SKIP\_VAULT=1**

Твоє сховище грейдеру недоступне: .secrets/infisical.env за правилами ДЗ #11 лежить поза git, а хмарний проєкт вимагає твого логіна. Тому в scripts/with-secrets.sh додай два рядки:

\# грейдер не має доступу до сховища: значення вже в оточенні

if \[ "${SKIP\_VAULT:-0}" = "1" \]; then exec "$@"; fi

**⚠️ Місце вставки має значення.** Вони йдуть після рядка \[ "$#" -gt 0 \] || set -- npm run start і перед рядком CREDS="$ROOT/.secrets/infisical.env" — тобто вже коли ENV\_SLUG відрізано від аргументів, а до сховища ще не зверталися. Готовий фрагмент цілком:

ENV\_SLUG="${1:-dev}"; shift || true

\[ "$#" -gt 0 \] || set -- npm run start

\# грейдер не має доступу до сховища: значення вже в оточенні

if \[ "${SKIP\_VAULT:-0}" = "1" \]; then exec "$@"; fi

CREDS="$ROOT/.secrets/infisical.env"

Якщо поставити if вище за shift, обгортка з'їсть перший аргумент і виконає слово dev як команду: кожен виклик упаде з exec: dev: not found, exit 127 — тобто нуль за всі команди, що ходять у базу, при цілком коректній роботі.

Це не «обхід» вимоги, а звичайний прод-патерн: у CI секрети підкладає runner, а не CLI сховища. Обгортка лишається на місці, шлях «зі сховища» лишається основним, і саме він перевіряється критерієм 9.

**Стартова точка.** Репозиторій курсового з compose-файлом (ДЗ #5) і схемою з ДЗ #12. Збірка — tsc (esbuild-транспілятори не емітять decorator-метадані).

**Acceptance criteria**

Грейдер виконує рівно ці команди у корені твого репо — свіжий клон, чиста БД, без доступу до твого сховища.

**🔐 Як це поєднується з вимогою «підключення зі сховища».** Команди, що ходять у базу, всередині загорнуті в scripts/with-secrets.sh — а сховища у грейдера немає: на свіжому клоні npm run migrate одразу падає з Please either run infisical init to connect to a project…, exit 1. Тому працює правило з п.8 постановки: команди нижче грейдер запускає з SKIP\_VAULT=1, а значення DB\_\* бере з дев-креденшелів твого docker-compose.yml — вони, як домовились ще на ДЗ #11, секретом не є. У README має бути готовий блок \## Grading рівно з цими рядками, наприклад:

docker compose up -d --wait

export DB\_HOST=127.0.0.1 DB\_PORT=5432 DB\_USER=app DB\_PASSWORD=app DB\_NAME=shop

export SKIP\_VAULT=1    # у грейдера немає доступу до сховища

Те, що основний шлях усе-таки веде у сховище, перевіряє статичний критерій 9 — він не потребує ані сховища, ані бази.

1.  \[ \] **Компіляція чиста.** npm ci && npx tsc --noEmit завершується без помилок.
2.  \[ \] **synchronize вимкнено.** grep -rn "synchronize" src/ не показує жодного synchronize: true. Порожній вивід теж зараховується: опція за замовчуванням false, і не вказати її — легальний варіант (тоді в README один рядок про це).
3.  \[ \] **Міграції створюють схему з нуля.** docker compose up -d --wait → npm run build → npm run migrate відпрацьовує без помилок, а npm run migrate:show показує всі міграції як \[X\]. Прапорець \--wait обов'язковий: без нього на свіжому томі міграція стартує раніше, ніж Postgres починає приймати з'єднання, і падає з Error: Connection terminated unexpectedly.
4.  \[ \] **Відкат працює.** npm run migrate:revert завершується успішно (у down() — не заглушка), повторний npm run migrate повертає схему.
5.  \[ \] **Relations на місці.** grep -rn "onDelete" src/ дає щонайменше 2 збіги з різними стратегіями — або з обґрунтуванням єдиної в README.
6.  \[ \] **Seed ідемпотентний.** npm run seed && npm run seed — без помилок; кількість рядків після другого запуску не змінилась (команду перевірки — SELECT count(\*) по основних таблицях — наведи в README).
7.  \[ \] **N+1 доведено і вилікувано.** npm run demo:nplus1 друкує кількість запитів «до» і «після»; «до» ≥ N (розмір колекції), «після» — мала константа, яка не залежить від N. Критерій — не «≤ 3», а «≤ 1 + 2 × рівнів» і незмінність числа при збільшенні вибірки (заміряно на графі order → items → product). Ті самі числа — у README.
8.  \[ \] **Звіт через QueryBuilder.** npm run report виводить агрегований результат; у коді звіту є групування — перевірка grep -rniE "\\.(add)?groupBy\\(" src/ ловить і .groupBy(, і .addGroupBy(.
9.  \[ \] **Підключення ORM приходить зі сховища.** Обгортка з ДЗ #11 зашита всередину npm-скриптів — команда нижче друкує OK і завершується з exit 0; і в DataSource немає зашитих креденшелів: grep -nE "password:\[\[:space:\]\]\*\['\\"\]" src/data-source.ts (або твій шлях до DataSource) дає порожній вивід. Варіант з одним url: process.env.DB\_URL проходить так само — там ключа password: просто немає. Перевірка статична: працює на свіжому клоні й без доступу до твого сховища.

node -e "const s=require('./package.json').scripts;const bad=\['migrate','seed'\]

  .filter(k=>/with-secrets\\.sh/.test(s\[k\]||'')===false);

  console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));

  process.exit(bad.length===0?0:1)"

  

**Формат здачі**

**Репозиторій:** той самий репозиторій курсового проєкту, гілка hw-13 + Pull Request.

**Структура** (у корені або у своєму каталозі сервісу):

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Файл / каталог</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#1a7f37">src/entities/</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">усі entities схеми з ДЗ #12</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#1a7f37">src/migrations/</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">згенеровані міграції</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#1a7f37">src/data-source.ts</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#1a7f37">DataSource</span><span class="ql-bg-transparent ql-color-#000000"> із </span><span class="ql-bg-transparent ql-color-#1a7f37">synchronize: false</span><span class="ql-bg-transparent ql-color-#000000"> і </span><span class="ql-bg-transparent ql-color-#1a7f37">migrations</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#1a7f37">src/seed.ts</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#000000">детермінований ідемпотентний seed</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#1a7f37">src/demo-nplus1.ts</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#000000">демо N+1 «до/після» з лічильником запитів</span></td></tr><tr><td data-row="7"><span class="ql-bg-transparent ql-color-#1a7f37">src/report.ts</span></td><td data-row="7"><span class="ql-bg-transparent ql-color-#000000">звіт через </span><span class="ql-bg-transparent ql-color-#1a7f37">createQueryBuilder().getRawMany()</span></td></tr><tr><td data-row="8"><span class="ql-bg-transparent ql-color-#1a7f37">package.json</span></td><td data-row="8"><span class="ql-bg-transparent ql-color-#000000">скрипти </span><span class="ql-bg-transparent ql-color-#1a7f37">build</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#1a7f37">migrate</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#1a7f37">migrate:show</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#1a7f37">migrate:revert</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#1a7f37">seed</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#1a7f37">demo:nplus1</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#1a7f37">report</span></td></tr><tr><td data-row="9"><span class="ql-bg-transparent ql-color-#1a7f37">README.md</span></td><td data-row="9"><span class="ql-bg-transparent ql-color-#000000">команди запуску, числа N+1 «до/після», межа Repository/QueryBuilder, вибір </span><span class="ql-bg-transparent ql-color-#1a7f37">onDelete</span><span class="ql-bg-transparent ql-color-#000000">, розділ </span><span class="ql-bg-transparent ql-color-#1a7f37">## Grading</span></td></tr></tbody></table>

  

**Вимога до README:** окремий розділ \## Grading з docker compose up -d --wait, рядком export DB\_\*=… з дев-значеннями твого compose і export SKIP\_VAULT=1. Без цього розділу грейдер на свіжому клоні не запустить жодної команди, що ходить у базу.

Грейдер має підняти все командами з acceptance criteria без правок файлів.

**У LMS здаєш посилання на PR**, не на головну гілку.

  

**Підказки, які економлять години**

1.  CLI міграцій працює зі **скомпільованим** DataSource: typeorm migration:generate -d dist/data-source.js src/migrations/Name, потім ще раз npm run build — згенерований .ts теж треба скомпілювати.
2.  Cannot find name 'process' означає, що не встановлений @types/node (npm i -D @types/node) — або що в tsconfig є поле types, у якому немає "node". Саме поле types не обов'язкове: поки його немає, TypeScript 6 підхоплює всі пакети з node\_modules/@types сам. Якщо ж "types": \["node"\] стоїть, а пакета немає, помилка буде інша — TS2688: Cannot find type definition file for 'node'.
3.  pg чекає user, TypeORM — username. Якщо «password authentication failed» при правильному паролі — це воно.
4.  Згенеровану міграцію читай: генератор не знає про дані. NOT NULL\-колонка на заповненій таблиці впаде; перейменування він бачить як DROP + ADD.
5.  N+1 не видно в коді — тільки в лозі. Найшвидший лічильник: власний Logger, що інкрементить лічильник на кожен query (приклад — у коді лекції, QueryCountLogger).
6.  Агрегати (SUM, COUNT) приходять рядками — bigint у number може не влізти.
7.  Не генеруй другу міграцію поруч із першою. migration:generate порівнює entity з живою БД: якщо схему вже застосовано, він скаже «No changes…»; якщо базу скинули, а старий файл лишився — отримаєш дві міграції, і migrate впаде на другій із relation "…" already exists (Postgres 42P07). Спочатку migrate до кінця, потім міняй entity, і лише тоді migration:generate.
8.  \--wait у compose — не косметика. docker compose up -d повертає керування, щойно контейнер створено; Postgres при цьому ще не приймає з'єднань, і наступний npm run migrate падає з Connection terminated unexpectedly. Або \--wait (потрібен healthcheck у compose — він у тебе з ДЗ #5), або цикл pg\_isready.
9.  Перевір свою роботу так, як її перевірятиме грейдер: зроби git clone свого ж репо в іншу теку і прожени звідти весь блок acceptance. Саме там вилазять .secrets/, .env і все інше, що є у тебе локально й немає в git.

**Зв'язок з курсовим проєктом**

Це ДЗ перетворює SQL-схему з ДЗ #12 на робочий data layer.

Поверх цих entities у ДЗ #14 з'явиться транзакційна бізнес-логіка (оформлення замовлення під конкурентним навантаженням), у ДЗ #16 — integration-тести через testcontainers, а звіт із QueryBuilder стане основою для кешування у ДЗ #23.
