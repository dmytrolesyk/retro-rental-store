# Pooling, replicas, sharding, backups і disaster recovery

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104321
Отримано: 2026-10-22T15:59:33.787Z

## Домашнє завдання

LMS ID: 54347

\# ДЗ до Лекції 15: PgBouncer + backup-скрипт + restore-drill для курсового

Курсовий проєкт: так

  

\## Постановка

  

База твого курсового вже має схему (#12), міграції (#13) і транзакції (#14). Тепер ти додаєш їй два атрибути production-системи: пулер зʼєднань на боці БД і бекап, у відновленні якого ти впевнений, бо сам його відновив.

  

Що робиш:

1\. PgBouncer перед Postgres курсового. У docker-compose.yml проєкту додаєш сервіс PgBouncer (образ на вибір, на лекції — edoburu/pgbouncer) з конфігом у репозиторії: pool\_mode = transaction, default\_pool\_size — невеликий (5-10), max\_client\_conn — з запасом (100+), адмін-консоль доступна (admin\_users). Застосунок ходить у базу через PgBouncer, не напряму. Нового секрета тут не зʼявляється: змінюється значення рядка підключення у сховищі з ДЗ #11 (оточення dev і prod) — новий env-файл заводити не треба, а в .env.example онови хост/порт у рядку-контракті (пароль там і далі фейковий). У README одним абзацом: чому transaction mode і що він ламає (мінімум три речі з лекції).

  

2\. Backup-скрипт. scripts/backup.sh: pg\_dump -Fc бази курсового → файл із датою в імені → backup destination на вибір: локальний volume, NFS або S3 (S3 глибоко — у #26, зараз достатньо і локальної теки поза контейнером; якщо все ж береш S3, ключі кладеш у сховище ДЗ #11, а не в новий env-файл). Поруч — рядок розкладу cron (файл backup.cron у репо), який запускає цей скрипт щоночі.

  

3\. Restore-drill. scripts/restore-drill.sh: бере останній дамп → відновлює його в чистий контейнер (порожній volume! окремий сервіс у compose або docker run) → доводить, що дані повернулись (порівнює контрольні значення до/після: кількість рядків + агрегат по ключовій таблиці) → друкує MATCH або падає з ненульовим кодом. Проганяєш drill один раз і фіксуєш результат у RESTORE-DRILL.md: дата, розмір дампу, час відновлення, виміряний RTO і чесний RPO твого розкладу бекапів (щоночі = до 24 год).

  

Стартова точка — репозиторій курсового після ДЗ #14. Референс механіки — код лекції code/15\_PoolingReplicasSharding (кроки 4 і 8).

  

\## Acceptance criteria

  

Грейдер виконує ці команди у корені твого репо — свіжий клон, чиста БД, без доступу до твого сховища.

  

🔐 Сховище + грейдер — та сама схема, що на ДЗ #13 і #14. Рядок підключення живе у сховищі з ДЗ #11, і scripts/backup.sh / scripts/restore-drill.sh беруть його звідти тією самою обгорткою: bash scripts/with-secrets.sh dev bash scripts/backup.sh. Це основний шлях. Але сховища у грейдера немає — голий bash scripts/backup.sh на свіжому клоні падає з DATABASE\_URL: unbound variable, а через обгортку без креденшелів — з Please either run infisical init to connect to a project…, обидва exit 1. Тому діє те саме правило: грейдер запускає з SKIP\_VAULT=1 і бере значення з дев-креденшелів твого docker-compose.yml. Розділ ## Grading у README (заведений ще на ДЗ #13) допиши під це ДЗ — рівно такими рядками, наприклад:

  

docker compose up -d --wait

export DATABASE\_URL=postgres://shop:shoppass@127.0.0.1:<порт pgbouncer>/shop

export SKIP\_VAULT=1    # у грейдера немає доступу до сховища

bash scripts/with-secrets.sh dev bash scripts/backup.sh

bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh

  

Обидві форми запуску нижче — «через обгортку» і «голий bash scripts/…» — зараховуються: перша під SKIP\_VAULT=1 просто виконує другу. Якщо твої скрипти читають DATABASE\_URL прямо з оточення (без обгортки всередині), достатньо export вище — але тоді напиши це в ## Grading явно.

  

\- \[ \] Стек піднімається однією командою, застосунок ходить через PgBouncer: docker compose up -d --wait → psql -h 127.0.0.1 -p <порт pgbouncer> -U <user> -d <db> -c "SELECT 1" повертає рядок 1. Порт PgBouncer має бути опублікований у compose (ports:) — грейдер ходить із хоста, не з мережі compose. Рядок-контракт у .env.example вказує на PgBouncer: grep -E '^(export\[\[:space:\]\]+)?(DATABASE\_URL|DB\_URL)=' .env.example дає хост/порт того сервісу, який compose піднімає як pgbouncer, а не прямий порт Postgres. Саме значення в репо не шукаємо — після ДЗ #11 воно живе у сховищі; у .env.example реальний тільки хост/порт, пароль фейковий.

\- \[ \] Transaction mode увімкнено в конфізі з репо: grep -E '^\\s\*pool\_mode\\s\*=\\s\*transaction' <шлях до pgbouncer.ini> дає збіг, і psql -p <порт pgbouncer> -U <admin\_user> -d pgbouncer -c "SHOW POOLS" показує твою базу з pool\_mode = transaction.

\- \[ \] Backup-скрипт працює і датує артефакти: bash scripts/with-secrets.sh dev bash scripts/backup.sh (під SKIP\_VAULT=1, див. рамку вище) завершується кодом 0 і друкує шлях/URI створеного бекапу, а в імені цього артефакта є дата запуску. Формат дати — на твій розсуд, аби читався однозначно: 2026-09-17, 20260917, 2026\_09\_17, 17.09.2026 (перевірка по імені: grep -E '\[0-9\]{4}\[-\_.\]?\[0-9\]{2}\[-\_.\]?\[0-9\]{2}|\[0-9\]{2}\[-\_.\]\[0-9\]{2}\[-\_.\]\[0-9\]{4}'). Далі — за обраним destination: для локальної теки/volume pg\_restore --list <файл> друкує TOC (доказ валідного -Fc архіву); для S3/NFS достатньо, що обʼєкт видно за надрукованим шляхом (aws s3 ls / ls), а придатність архіву доведе restore-drill нижче. Назва теки для дампів — теж на твій розсуд, грейдер бере шлях із виводу скрипта.

\- \[ \] Cron-розклад лежить у репо: grep -cE '^(@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)|(\[0-9\*/,-\]+\[\[:space:\]\]+){4}\[0-9\*/,-\]+)\[\[:space:\]\]+.\*backup' backup.cron виводить число ≥ 1 — тобто пʼять полів розкладу або @daily-скорочення, плюс команда зі словом backup.

\- \[ \] Restore-drill доводить відновлення: bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh (під SKIP\_VAULT=1) завершується кодом 0 і друкує MATCH; відновлення йде у контейнер/volume, якого не існувало до запуску (перевірка: скрипт сам його створює і сам прибирає — повторний запуск теж дає MATCH).

\- \[ \] RTO/RPO задокументовані числами: grep -iE 'RTO|RPO' RESTORE-DRILL.md дає обидва терміни, і поруч із кожним стоїть виміряне/розраховане значення з одиницями часу (секунди/хвилини/години), не «швидко».

  

\## Формат здачі

  

\- Той самий репозиторій курсового проєкту, гілка hw-15, Pull Request у main.

\- Структура (нове до існуючого проєкту):

  - docker-compose.yml — + сервіс PgBouncer (і, за бажанням, сервіс для drill)

  - pgbouncer/pgbouncer.ini (+ userlist.txt) — конфіг у репо, без секретів прод-рівня

  - scripts/backup.sh · scripts/restore-drill.sh — обидва запускаються з кореня репо і беруть підключення з process.env/$DATABASE\_URL, який наповнює обгортка scripts/with-secrets.sh з ДЗ #11 (нового env-файла не заводимо)

  - backup.cron — рядок розкладу

  - RESTORE-DRILL.md — протокол drill-у: дата, розмір, час, RTO/RPO

  - README.md — розділ «Data layer ops»: як підняти, як зробити бекап, як відновитись, чому transaction mode

\- Грейдер має відтворити все трьома командами — docker compose up -d --wait → бекап → drill — без правок файлів, узявши перед ними два export із твого розділу ## Grading (DATABASE\_URL дев-рівня + SKIP\_VAULT=1).

\- у README.md — оновлений розділ ## Grading з ДЗ #13: docker compose up -d --wait, export DATABASE\_URL=… з дев-значеннями твого compose (хост/порт — PgBouncer), export SKIP\_VAULT=1 і два рядки запуску бекапу та drill-у. Без цього розділу грейдер на свіжому клоні не виконає ані бекап, ані drill.

\- У LMS здаєш посилання на PR.

  

\## Підказки, які економлять години

  

\- PgBouncer + SCRAM: найпростіше — плоский userlist.txt ("user" "password") і auth\_type = scram-sha-256; пароль у userlist має збігатися з паролем Postgres.

\- pg\_restore у чисту базу — з --no-owner, інакше впадеш на власниках обʼєктів.

\- Контрольна сума з лекції: SELECT count(\*) || '|' || sum(<числова колонка>) FROM <ключова таблиця> — одна команда, яку легко порівняти до/після.

\- Drill у непорожній volume — головна причина фальшивих duplicate key помилок: завжди зноси volume перед відновленням.

\- ORM/застосунок через PgBouncer у transaction mode: вимкни named prepared statements драйвера або постав max\_prepared\_statements = 200 у PgBouncer ≥ 1.21.

  

\## Зв'язок з курсовим проєктом

  

Це ДЗ додає твоєму Marketplace API (або обраному домену) операційний шар бази: пулер, який переживе ріст числа інстансів у #28 (Kubernetes), і бекап-процедуру, яку #26 (S3) переведе на справжній object storage, а #29 (Observability) навчить моніторити. RESTORE-DRILL.md — перший документ твого проєкту, написаний мовою SRE: далі ці ж RTO/RPO зустрінуться в SLO лекції 29 і на захисті.
