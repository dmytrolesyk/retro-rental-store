# RabbitMQ та альтернативи: NATS і SQS

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104325
Отримано: 2026-10-12T13:44:16.198Z

## Домашнє завдання

LMS ID: 54351

Постановка

У ДЗ #18 realtime-фіча доставляла тому, хто зараз підключений: немає одержувача — немає доставки. Сьогодні між твоїм сервісом і його читачами зʼявляється посередник, який зберігає повідомлення до появи одержувача. Це вся різниця між транспортом і брокером — і за неї доводиться платити трьома окремими рахунками:

1.  **Робота може зникнути.** У чому проявляється: підтвердив рано (autoAck) — і падіння забрало все, що було у вікні. Чим платимо: ручний ack після ефекту.
2.  **Робота може виконатись двічі.** У чому проявляється: підтвердив пізно — ack не доїхав, брокер повернув повідомлення. Чим платимо: ідемпотентний ефект у споживача.
3.  **Робота може застрягти назавжди.** У чому проявляється: повідомлення, яке не обробиться ніколи, крутиться в черзі й вічно гріє кластер. Чим платимо: DLQ як окремий контур.

**⚠️ Головна змістова вимога ДЗ — правильно назвати те, що ти зробив.** exactly-once на рівні доставки не існує ні в кого. Твоє ДЗ дає at-least-once доставку плюс ідемпотентний ефект — і разом вони дають exactly-once результат. Формулювання «RabbitMQ дає exactly-once» у README — це знята оцінка, а не стилістика. І не плутай два різні слова: ідемпотентність — властивість операції (UPDATE orders SET status='packed' WHERE id=42 ідемпотентний, qty = qty - 1 — ні); ключ ідемпотентності — інструмент, яким неідемпотентну операцію роблять безпечною для повтору.

Що робиш:

**1\. Топологія: exchange + черга + binding.** Заведи topic-exchange для подій свого домену (для Marketplace — shop.events), чергу під подію order.placed і binding між ними. Оголошує топологію споживач або окремий бутстрап-крок, не продюсер: продюсер не має знати, хто його слухає. Routing key без відповідного binding — порожній звук: повідомлення мовчки зникає, і продюсер при цьому отримує позитивний confirm.

**2\. Публікація події** **order.placed****.** Подія виходить із твоєї критичної бізнес-операції (оформлення замовлення). У тіло кладеш свідомо спроектований контракт — eventId, type, occurredAt, дані — а не ORM-сутність через spread. eventId має бути стабільним: саме за ним споживач упізнає дубль. ⚠️ Публікуй із confirm-каналом (createConfirmChannel + waitForConfirms) або з mandatory: true. Інакше «опублікував» означає лише «віддав у сокет».

**3\. Споживач із ручним ack.** noAck: false, ack — після ефекту, а не до нього. Це рівно та відмінність, через яку в кроці 1 лекції зникло чотири завдання з пʼяти.

**4\. prefetch виставлений і обґрунтований числом.** Дефолт брокера — 0, і нуль означає без ліміту: перший підписаний споживач забирає всю чергу, другий простоює. Постав своє число і поясни його в README одним реченням за формулою prefetch × час обробки < consumer\_timeout (стоковий таймаут — 30 хвилин). prefetch=1 — правильна відповідь для важких задач і найгірша для задач по 2 мс.

**5\. DLQ як окремий контур.** DLX-exchange + черга під нього + x-dead-letter-exchange на робочій черзі (аргументом при оголошенні або політикою — обидва варіанти легальні і обидва перевірені). Демо має показати повідомлення в DLQ і прочитати причину з x-death / x-first-death-reason. Причина — одна з чотирьох: rejected, expired, maxlen, delivery\_limit. Пʼятої немає.

**6\. Ідемпотентний споживач.** Повторна доставка тієї самої події не подвоює ефект. Найдешевша коректна форма — висловити ефект через природний ключ (INSERT … ON CONFLICT DO NOTHING за eventId або за ключем бізнес-операції), а не через UPDATE qty = qty - 1. Якщо природного ключа немає — веди сховище оброблених ідентифікаторів. ⚠️ Дедуп у памʼяті процесу (Set/Map) не рахується: гарантія живе рівно стільки, скільки інстанс, і не існує між двома подами. Сховище має пережити рестарт споживача.

**7\. Три демо-скрипти з фіксованими іменами** (щоб грейдер не вгадував): demo:publish, demo:dlq, demo:duplicate. Кожен: (1) сам приводить стан до чистого, (2) друкує підсумок рядками ключ=значення, (3) сам перевіряє інваріант і завершується з кодом ≠ 0, якщо той порушено.

**8\. Секрети — зі сховища ДЗ #11, нових env-файлів не заводимо.** Адреса брокера їде у сховище поруч із підключенням до бази з ДЗ #12. Три нові npm-скрипти ходять у брокер, тому починаються з bash scripts/with-secrets.sh dev … — рівно як migrate/seed із ДЗ #13. Аварійний вхід SKIP\_VAULT=1 уже у твоїй обгортці, дописувати нічого не треба.

**9\. README-секція «Async-події через RabbitMQ»** з власними числами трьох прогонів, обґрунтуванням prefetch і окремим абзацом-відповіддю: чому це at-least-once, а не exactly-once, і що саме довелося зробити, щоб результат був один.

**Контракт виводу демо (це і є те, що читає грейдер)**

Один рядок = ключ=значення, ключі ASCII, у будь-якому порядку, зайві рядки дозволені. Усі значення — числа, крім dlq-reason, де значення — одне з чотирьох слів причини.

1.  demo:publish — published delivered effect acked dlq prefetch
2.  demo:dlq — rejected work dlq dlq-reason effect
3.  demo:duplicate — deliveries effect skipped
4.  published — скільки подій опубліковано у цьому прогоні. У demo:publish це рівно 5.
5.  delivered — скільки доставок отримав консюмер цього ДЗ (якщо в тебе на подію підписано ще й аудит-черга, її доставки сюди не рахуються).
6.  effect — скільки разів ефект фактично застосовано; відкинуті як дублі не рахуються. Якщо одна подія у твоєму домені породжує кілька рядків — зведи effect до кількості застосованих подій, а не рядків.
7.  work / dlq — глибина робочої черги і DLQ на момент кінця демо.
8.  prefetch — число, яке ти реально передав у channel.prefetch() / prefetchCount.

**Про брокер і тип черги**

Брокер тут предмет ДЗ, а не інструмент: це RabbitMQ. Версія — на твій розсуд; 4.2.x — LTS-серія (комерційна підтримка до 30.06.2030), 4.3.x — поточна (до 30.04.2028). Різниця у два роки — це готова відповідь на співбесідне «яку версію ставили в прод».

Тип черги — краще quorum ('x-queue-type': 'quorum'): у ньому працює delivery-limit, тобто причину delivery\_limit можна показати без окремих зусиль. classic теж проходить усі критерії — просто причину смерті доведеться зробити через rejected (reject/nack із requeue=false), expired (TTL) або maxlen. Класичне дзеркалювання (ha-mode) не пропонуй: воно прибране з RabbitMQ 4.0.

Змінну з адресою брокера в блоці \## Grading пиши під свій compose — схема й порт мають збігатися: amqp://user:pass@host:5672, де 5672 — це AMQP. По 15672 брокер не відповідає протоколом AMQP: там вебморда менеджменту. Жоден із девʼяти критеріїв цю змінну не читає, але грейдер копіює блок дослівно, тож неробоча пара «схема + порт» коштуватиме тобі зайвого раунду листування.

Збірка — tsc. Стартова точка — репозиторій курсового з ДЗ #18.

Acceptance criteria

**🔐 Сховище + грейдер — так само, як на ДЗ #13/#14/#16.** Команди, що ходять у брокер, усередині загорнуті в scripts/with-secrets.sh, а сховища у грейдера немає. Тому діє те саме правило: грейдер запускає з SKIP\_VAULT=1, а значення бере з дев-креденшелів твого docker-compose.yml. Розділ \## Grading у README має бути дописаний під це ДЗ — приблизно так:

cd services/api        # ← тільки якщо сервіс лежить у підкаталозі

docker compose up -d --wait

export BROKER\_URL=amqp://app:app@127.0.0.1:5672 # ← ПІД ТВІЙ compose: схема amqp, порт AMQP

export SKIP\_VAULT=1      # у грейдера немає доступу до сховища

npm ci

\--wait обовʼязковий (та сама вимога, що в ДЗ #11/#13/#14/#16), і для RabbitMQ він критичніший, ніж для Postgres: між тим, як відкриється TCP-порт, і тим, як Erlang-нода почне приймати basic.publish, є вікно, у яке клієнт ловить ECONNRESET. Здоровʼя перевіряй через rabbitmq-diagnostics -q check\_running, а не через «порт відкрився».

**📁 Де лежить package.json.** Команди грейдер запускає з того каталогу, де лежить твій package.json; пошукові критерії (5, 6, 8, 9) — з кореня репо. Розкладка «сервіс у підкаталозі» перевірена окремо і проходить усі 9 критеріїв — за умови, що перший рядок \## Grading це cd <тека сервісу>.

**🔎 Критерії перевіряють ПОВЕДІНКУ, а не форму.** Жоден критерій не дивиться на імена exchange, черг і binding, не вимагає конкретного клієнта і не грепає числові літерали. amqplib, rabbitmq-client чи @nestjs/microservices; DLX аргументом черги або політикою; quorum або classic; причина смерті rejected або delivery\_limit; .env.example або .env.sample — усе це проходить. Ловиться рівно те, що ДЗ і обіцяє: подія доходить, отруєне повідомлення йде окремим контуром із читабельною причиною, дубль не подвоює ефект, prefetch не лишений дефолтним.

☐ **1\. Компіляція чиста:** npm ci && npx tsc --noEmit завершується без помилок.

☐ **2\. Happy path + prefetch виставлений:** npm run demo:publish завершується з exit 0 і друкує published=5, effect=5, dlq=0, а також рядок prefetch=N, де 1 ≤ N ≤ 2000 (2000 — жорстка стеля prefetch у quorum-чергах). Пʼять подій — пʼять ефектів, нічого не поїхало в DLQ.

npm run demo:publish | tee /tmp/p.txt; echo "exit=${PIPESTATUS\[0\]}"

for k in published=5 effect=5 dlq=0; do

  grep -qx "$k" /tmp/p.txt || echo "НЕМАЄ: $k"

done

awk -F= '/^prefetch=/{ok=($2+0>=1 && $2+0<=2000)} END{exit !ok}' /tmp/p.txt \\

  && echo "prefetch у діапазоні OK" || echo "prefetch поза 1..2000 (дефолт 0 не рахується)"

☐ **3\. Отруєне повідомлення пішло в DLQ, і причина прочитана:** npm run demo:dlq завершується з exit 0, друкує work=0, dlq=1 і рядок dlq-reason= з однією з чотирьох причин.

npm run demo:dlq | tee /tmp/d.txt; echo "exit=${PIPESTATUS\[0\]}"

for k in work=0 dlq=1; do grep -qx "$k" /tmp/d.txt || echo "НЕМАЄ: $k"; done

grep -qxE 'dlq-reason=(rejected|expired|maxlen|delivery\_limit)' /tmp/d.txt \\

  && echo "причина прочитана з x-death" || echo "НЕМАЄ читабельної причини"

Альтернатива не перелічена навмисно: інших причин dead-letter у RabbitMQ немає. Протухання самої черги dead-letter-ом не є — якщо ти сподівався показати DLQ через queue TTL, перевір це першим.

☐ **4\. ⭐ Дубль доставлено, а ефект застосовано один раз:** npm run demo:duplicate завершується з exit 0, друкує deliveries ≥ 2 і при цьому effect=1.

npm run demo:duplicate | tee /tmp/u.txt; echo "exit=${PIPESTATUS\[0\]}"

awk -F= '/^deliveries=/{ok=($2>=2)} END{exit !ok}' /tmp/u.txt && echo "deliveries>=2 OK"

grep -qx 'effect=1' /tmp/u.txt || echo "НЕМАЄ: effect=1"

Як саме викликати повторну доставку — на твій розсуд, усі три форми легальні: обрив зʼєднання споживача після ефекту, але до ack (як крок 2 у коді лекції); nack/reject із requeue=true після того, як ефект уже застосовано; або справжній kill -9 дочірнього процесу-споживача. Напиши в README, що обрав. Критерій навмисно не вимагає конкретної форми: він перевіряє наслідок, а не спосіб.

⚠️ channel.close() для цього не годиться: це коректне завершення, і requeue там теж станеться — але падіння сервісу в проді виглядає інакше, і саме його треба показати. ⚠️ І окремо: deliveries=1 — це не «ідемпотентність спрацювала так добре, що дубля не було». Це означає, що дубля не відбулось узагалі, тобто демо нічого не довело. Найчастіша причина — noAck: true: під autoAck повідомлення зникає в момент доставки, повертати нічого.

☐ **5\. DLX справді сконфігуровано:**

grep -rniE --include='\*.ts' --include='\*.js' --include='\*.mjs' --include='\*.cjs' \\

  --include='\*.json' --include='\*.sh' --include='\*.yml' --include='\*.yaml' --include='\*.sql' \\

  --exclude-dir=node\_modules --exclude-dir=dist --exclude-dir=.git \\

  "dead\[ \_-\]\*letter\[ \_-\]\*(exchange|routing)" .

дає щонайменше один збіг. Патерн \[ \_-\]\* навмисно вільний і перевірений на 12 легальних формах: 'x-dead-letter-exchange', "x-dead-letter-routing-key", camelCase deadLetterExchange і deadLetterRoutingKey, snake\_case dead\_letter\_exchange, JSON у політиці {"dead-letter-exchange": "..."}, той самий JSON усередині rabbitmqctl set\_policy у shell-скрипті, queueOptions.arguments у Nest-конфізі. Файли \*.md у пошук навмисно не входять: згадка DLX у README не має зараховуватись за конфігурацію.

☐ **6\. prefetch виставляється в коді, а не лишається дефолтним:**

grep -rniE --include='\*.ts' --include='\*.js' --include='\*.mjs' --include='\*.cjs' --include='\*.json' \\

  --exclude-dir=node\_modules --exclude-dir=dist --exclude-dir=.git \\

  "prefetch|basic\[.\_-\]?qos" .

дає щонайменше один збіг. Патерн перевірений на 9 формах: ch.prefetch(10), prefetchCount: 10, prefetch\_count, константа PREFETCH, basic.qos, basicQos, qos({ prefetch: 5 }). ⚠️ Це допоміжна статична перевірка: слово prefetch у коментарі її задовольнить. Справжній доказ — критерій 2, і саме він ловить рішення, яке лишило дефолтний 0.

☐ **7\. Демо ходять у брокер через обгортку зі сховищем:**

node -e "const s=require('./package.json').scripts;const bad=\['demo:publish','demo:dlq',

'demo:duplicate'\].filter(k=>/with-secrets\\.sh/.test(s\[k\]||'')===false);console.log(bad.length===0

?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)"

друкує OK і завершується з exit 0. Перевірка статична — ані сховища, ані брокера не потребує. Якщо обгортка не в самому скрипті, а в скрипті, який він викликає, — винеси її в сам скрипт: критерій дивиться на рядок демо-скрипта.

☐ **8\. У README є розділ** **\## Grading****:**

grep -rlE '^#{1,3} +Grading' --include='README.md' --exclude-dir=node\_modules . | wc -l

друкує ≥ 1. Без цього розділу грейдер на свіжому клоні не запустить жодного з трьох демо.

☐ **9\. Жодного трекнутого env-файла з живим рядком підключення:**

for f in $(git ls-files | grep -E '(^|/)\\.env($|\\.)' | grep -vE '\\.(example|sample|template|dist)$'); do

  grep -lE '=(amqps?|postgres(ql)?|redis|https?)://\[^ \]\*:\[^ @\]+@' "$f"

done

дає порожній вивід. Значення приходять зі сховища ДЗ #11. Файл-контракт зі змінними (.env.example, .env.sample, .env.template) — не порушення навіть якщо в ньому стоїть URL-подібний плейсхолдер на кшталт amqp://USER:PASSWORD@host:5672: він відсіяний фільтром за розширенням, і це перевірено окремо на обох іменах.

Формат здачі

1.  Той самий репозиторій курсового проєкту, гілка hw-19 + Pull Request.
2.  Структура (у корені або у своєму каталозі сервісу):

<table><tbody><tr><td data-row="1"><strong class="ql-bg-transparent ql-color-#1a1a1a">Файл</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#1a1a1a">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#1a1a1a">оголошення топології</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#1a1a1a">exchange, черга, binding, DLX + DLQ — на боці споживача або бутстрапу, не продюсера</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#1a1a1a">код публікації та споживача</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#1a1a1a">публікація </span><span class="ql-bg-transparent ql-color-#1a7f4b">order.placed</span><span class="ql-bg-transparent ql-color-#1a1a1a"> із бізнес-операції; ручний </span><span class="ql-bg-transparent ql-color-#1a7f4b">ack</span><span class="ql-bg-transparent ql-color-#1a1a1a">, </span><span class="ql-bg-transparent ql-color-#1a7f4b">prefetch</span><span class="ql-bg-transparent ql-color-#1a1a1a">, ідемпотентний ефект</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#1a1a1a">три демо-скрипти</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#1a1a1a">самоочисні, друкують </span><span class="ql-bg-transparent ql-color-#1a7f4b">ключ=значення</span><span class="ql-bg-transparent ql-color-#1a1a1a">, самі перевіряють інваріант і повертають код ≠ 0</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#1a7f4b">package.json</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#1a1a1a">npm-скрипти </span><span class="ql-bg-transparent ql-color-#1a7f4b">demo:publish</span><span class="ql-bg-transparent ql-color-#1a1a1a">, </span><span class="ql-bg-transparent ql-color-#1a7f4b">demo:dlq</span><span class="ql-bg-transparent ql-color-#1a1a1a">, </span><span class="ql-bg-transparent ql-color-#1a7f4b">demo:duplicate</span><span class="ql-bg-transparent ql-color-#1a1a1a"> — усі три через </span><span class="ql-bg-transparent ql-color-#1a7f4b">scripts/with-secrets.sh</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#1a7f4b">docker-compose.yml</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#1a1a1a">RabbitMQ (образ із суфіксом </span><span class="ql-bg-transparent ql-color-#1a7f4b">-management</span><span class="ql-bg-transparent ql-color-#1a1a1a"> економить години: без нього не подивитись на </span><span class="ql-bg-transparent ql-color-#1a7f4b">x-death</span><span class="ql-bg-transparent ql-color-#1a1a1a"> очима)</span></td></tr><tr><td data-row="7"><span class="ql-bg-transparent ql-color-#1a7f4b">README.md</span></td><td data-row="7"><span class="ql-bg-transparent ql-color-#1a1a1a">секція «Async-події через RabbitMQ» з власними числами + оновлений розділ </span><span class="ql-bg-transparent ql-color-#1a7f4b">## Grading</span></td></tr></tbody></table>

  

Грейдер має підняти все командами з acceptance criteria без правок файлів.

У LMS здаєш **посилання на PR**.

Підказки, які економлять години

1.  x-arguments на вже існуючій черзі змінити не можна. Додав x-dead-letter-exchange до assertQueue — і отримав 406 PRECONDITION\_FAILED - inequivalent arg 'x-dead-letter-exchange' for queue '…'. Це не баг клієнта: аргументи черги незмінні. Або знеси чергу (rabbitmqctl delete\_queue <ім'я>), або — краще — вішай DLX політикою: політику можна перезаписати без перестворення черги.
2.  Позитивний ack від брокера не означає, що повідомлення кудись доїхало. Якщо жоден binding не збігся, брокер надішле confirm — його відповідальність полягала в тому, щоб коректно викинути. Лікується трьома способами: mandatory: true + слухач basic.return, alternate exchange, або метрика «unroutable». Найдешевший дефолт — alternate exchange: одне налаштування замість прапорця на кожній публікації.
3.  nack(requeue=true) і reject(requeue=true) — не синоніми. На RabbitMQ 4.3 reject інкрементить delivery-count і врешті доводить повідомлення до delivery-limit і DLX, а nack — не інкрементить, тож цикл на ньому не обмежений нічим і гріє кластер вічно. Якщо твоє демо DLQ через delivery\_limit не спрацьовує — перевір, який саме виклик ти зробив.
4.  dead-letter-strategy: at-least-once без overflow: reject-publish мовчки не працює. Політика приймається, в effective\_policy\_definition вона є, а брокер відкочується на at-most-once і повідомляє про це тільки в логу. Для ДЗ дефолт цілком годиться — але знати про це треба, і абзац у README про це коштує пʼять хвилин.
5.  prefetch × час обробки має бути менше за consumer\_timeout. Стокові 30 хвилин здаються нескінченністю, поки не поставиш prefetch=500 при обробці по 10 секунд: це 83 хвилини, тобто таймаут пробивається. Коли він спрацьовує, брокер спершу шле basic.cancel, і наївний обробник (if (!msg) return;) цього не помічає — код ще працює і шле ack у нікуди.
6.  Список оброблених у памʼяті процесу — це не дедуп. Він не переживе рестарт пода й не існує між двома репліками. Клади ефект або позначку туди, де вже живуть твої дані.
7.  Щілину між «позначив оброблене» і «застосував ефект» сьогодні ми не закриваємо. Впасти в ній — і ключ уже позначено, а ефекту немає. Закриває її не менша щілина, а спільна транзакція: позначка й ефект одним COMMIT в одну базу. Це вже ДЗ #22; тут достатньо назвати цю межу в README одним реченням.
8.  Споживача для демо запускай окремим процесом. channel.close() — коректне завершення, і брокер requeue-ить непідтверджені навмисно; падіння сервісу виглядає інакше — процес зникає, ОС закриває сокет, брокер бачить обрив. Для критерію 4 підходять обидві форми, але друга — це те, що буває в проді о 3-й ночі.

Зв'язок з курсовим проєктом

Це девʼятий крок проєктної лінії — і той, після якого в курсовому зʼявляється асинхронний канал зі специфікації захисту (пункт «Async pattern»). Закритий він буде не повністю: у специфікації цей пункт звучить як «RabbitMQ + outbox для подій», і другу половину додає ДЗ #22. Він стоїть на бізнес-операції з ДЗ #14 і на realtime-фічі з ДЗ #18: те, що WebSocket показував підключеним «зараз», тепер має надійного двійника, який доживе до появи одержувача.

Далі: ДЗ #22 візьме рівно цю подію й закриє дві речі, які сьогодні лишились відкритими — transactional outbox («база і брокер атомарно», бо спільного COMMIT між ними не існує) і processed\_messages («позначка про обробку та ефект — в одній транзакції»). ДЗ #23 покладе поверх тієї ж події Redis і чергу BullMQ. Тому контракт події варто спроектувати зараз — переписувати консюмерів двічі не хочеться нікому.

І головне, що варто винести з цього ДЗ у резюме й на співбесіду: ack — це не «дійшло», це «я більше не вимагаю повтору». З цієї однієї фрази виводиться все інше: підтвердив рано — втрата, підтвердив пізно — дубль, третього немає. Exactly-once доставки не існує; існує at-least-once доставка плюс ідемпотентний ефект, і разом вони дають exactly-once результат. Твій demo:duplicate — це рівно те місце, де це видно очима.
