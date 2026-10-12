# Realtime-комунікація: WebSockets, SSE та RxJS

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104324
Отримано: 2026-10-12T13:43:59.875Z

## Домашнє завдання

LMS ID: 54350

**Курсовий проєкт**: так

  

Постановка

Твій Marketplace API вже вміє змінювати статус замовлення (транзакційна логіка з ДЗ Лекції 14). Але покупець дізнається про це лише коли перезавантажить сторінку. Ти додаєш realtime-шар: подія «статус замовлення змінився» доходить до підключеного клієнта миттєво — і робиш це двома транспортами, щоб на власному коді відчути trade-offs, про які говорили на лекції.

  

Що робиш:

**1\. WebSocket-нотифікації через gateway.** @WebSocketGateway() (socket.io-платформа) у твоєму Nest-проєкті. Клієнт після підключення шле join з id замовлення; сервер кладе сокет у кімнату orders:<id> — після перевірки, що замовлення належить цьому користувачу (guard або перевірка в handler-і; анонімному або чужому — відмова). Коли існуючий endpoint зміни статусу спрацьовує, сервіс емітить order.status тільки в кімнату цього замовлення (server.to(...)), а не всім.

**2\. SSE-варіант того самого потоку.** GET /orders/:id/events віддає content-type: text/event-stream і шле ті самі події зміни статусу. Кожна подія — з полем id: (номер події, що зростає). Якщо клієнт реконектиться із заголовком Last-Event-ID: N — віддай пропущені події з номерами > N (буфер останніх подій у памʼяті достатній).

**3\. Headless-демо** **scripts/realtime-demo.mjs****.** Скрипт (socket.io-client) підключає двох клієнтів у різні кімнати (замовлення A і замовлення B), через HTTP змінює статус замовлення A і друкує результат машинно-читаними рядками A\_RECEIVED=1 / B\_RECEIVED=0. Скрипт завершується сам: код 0 при успіху, 1 — якщо ізоляція кімнат порушена.

Плюс контрольний режим \--same-room: обидва клієнти заходять у кімнату замовлення A. Тоді очікування протилежне — B\_RECEIVED=1, і саме це є успіхом (код 0). Цей режим не «додаткова фіча»: він доводить, що скрипт міряє реальність, а не друкує заздалегідь відому відповідь. Скрипт, який завжди виводить B\_RECEIVED=0, на контрольному прогоні себе видасть.

**4\. Порівняння trade-offs у README** — розділ \## Trade-offs: WebSocket vs SSE з таблицею мінімум на 4 критерії (напрям каналу, реконект/відновлення, вимоги до інфраструктури, ціна на подію) і 2–3 реченнями: який транспорт ти лишив би для нотифікацій у проді й чому.

Збірка — як на лекції: tsc → node dist (tsx не емітить декоратор-метадані). Redis-адаптер для одного інстанса не потрібен — але в README одним реченням напиши, що зламається при двох інстансах і чим це лікується (лекція, крок 7).

  

Acceptance criteria

  

Грейдер виконує рівно ці перевірки в корені твого репо (свіжий клон, застосунок піднятий за інструкцією з README):

☐ **SSE-заголовок:** curl -sN --max-time 2 -D - -o /dev/null [http://localhost:3000/orders/<id>/events](http://localhost:3000/orders/\<id\>/events) | grep -i '^content-type' виводить text/event-stream.

☐ **Формат подій:** curl -sN --max-time 5 [http://localhost:3000/orders/<id>/events](http://localhost:3000/orders/\<id\>/events) після зміни статусу цього замовлення (будь-яким способом — паралельний curl на твій API або сідер) показує блок із рядками id:, event: та data: зі статусом у JSON.

☐ **Last-Event-ID:** зроби щонайменше 4 зміни статусу цього замовлення (події 1..N, N ≥ 4), тоді

curl -sN --max-time 2 -H 'Last-Event-ID: 3' [http://localhost:3000/orders/<id>/events](http://localhost:3000/orders/\<id\>/events) | grep '^id:' | head -1

виводить id > 3 (пропущене доїхало, дублів немає). Межа саме 4, а не 3: при рівно трьох подіях подій з id > 3 ще не існує, і критерій провалив би коректну реалізацію.

☐ **Ізоляція кімнат — ДВА прогони, основний і контрольний.** Різниця між ними і є доказом:

\# основний: клієнти в РІЗНИХ кімнатах — B не має чути подію замовлення A

node scripts/realtime-demo.mjs;       echo "exit=$?"

# A\_RECEIVED=1

# B\_RECEIVED=0

# exit=0

\# КОНТРОЛЬНИЙ: обидва клієнти в кімнаті замовлення A — B МУСИТЬ почути

node scripts/realtime-demo.mjs --same-room; echo "exit=$?"

# A\_RECEIVED=1

# B\_RECEIVED=1

# exit=0

  

Зелено, коли обидва прогони дали exit=0 і B\_RECEIVED між ними змінився з 0 на 1. Якщо на контрольному прогоні теж B\_RECEIVED=0 — скрипт друкує константу, а не вимірює: критерій червоний незалежно від коду виходу.

  

☐ **Trade-offs у README:** дві команди — розділ існує і це таблиця:

sec=$(awk 'tolower($0) ~ /^#+ .\*trade\[ -\]?off/{f=1;next} f && /^#+ /{exit} f' README.md)

printf '%s\\n' "$sec" | grep -cE '^ \*\\|? \*:?-{3,}' # ≥ 1 — рядок-роздільник, тобто це справді таблиця

printf '%s\\n' "$sec" | grep -c '|'         # ≥ 4 — шапка + роздільник + мінімум 2 рядки вмісту

  

Перевірка навмисно рахує рядки всередині розділу, а не «12 рядків після слова trade-off», і не вимагає крайніх |: таблиця Критерій | WS | SSE без крайніх символів — валідний GFM і має проходити. Абзац «все залежить від задачі» дає 0 і 0. Проза перед таблицею (той самий висновок на 2–3 речення) критерію не заважає.

  

Формат здачі

1.  Той самий репозиторій курсового проєкту, гілка hw-18 + Pull Request.
2.  Структура (додається до наявної):

<table><tbody><tr><td data-row="1"><strong class="ql-bg-transparent ql-color-#1a1a1a">Файл</strong></td><td data-row="1"><strong class="ql-bg-transparent ql-color-#1a1a1a">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#1a7f4b">src/**/*.gateway.ts</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#1a1a1a">WebSocket-gateway: </span><span class="ql-bg-transparent ql-color-#1a7f4b">join</span><span class="ql-bg-transparent ql-color-#1a1a1a">, кімната </span><span class="ql-bg-transparent ql-color-#1a7f4b">orders:&lt;id&gt;</span><span class="ql-bg-transparent ql-color-#1a1a1a">, перевірка власника замовлення</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#1a7f4b">src/**/order-events.service.ts</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#1a1a1a">шина подій (Subject) + буфер останніх подій — спільна для WS і SSE</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#1a7f4b">src/**/orders.controller.ts</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#1a7f4b">GET /orders/:id/events</span><span class="ql-bg-transparent ql-color-#1a1a1a"> — SSE-потік з </span><span class="ql-bg-transparent ql-color-#1a7f4b">id:</span><span class="ql-bg-transparent ql-color-#1a1a1a"> та підтримкою </span><span class="ql-bg-transparent ql-color-#1a7f4b">Last-Event-ID</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#1a7f4b">scripts/realtime-demo.mjs</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#1a1a1a">headless-демо ізоляції кімнат + контрольний режим </span><span class="ql-bg-transparent ql-color-#1a7f4b">--same-room</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#1a7f4b">README.md</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#1a1a1a">розділ </span><span class="ql-bg-transparent ql-color-#1a7f4b">## Trade-offs: WebSocket vs SSE</span><span class="ql-bg-transparent ql-color-#1a1a1a">, команди запуску демо, речення про 2+ інстанси</span></td></tr></tbody></table>

  

Emit у кімнату йде з бізнес-логіки зміни статусу, а не з контролера навпростець. Грейдер має відтворити все командами з README без правок коду.

У LMS здаєш **посилання на PR**.

  

Підказки, які економлять години

1.  Порядок демо в realtime-demo.mjs: підключи клієнтів → дочекайся ack від join → лише потім міняй статус. Інакше подія вилетить раніше, ніж клієнт у кімнаті.
2.  \--same-room реалізується одним рядком: id кімнати другого клієнта береться з прапорця (const roomB = process.argv.includes('--same-room') ? orderA : orderB), а очікуване значення B\_RECEIVED — звідти ж. Не роби для контролю окремий скрипт: сенс саме в тому, що обидва прогони йдуть тим самим кодом.
3.  Події реконекту socket.io живуть на manager-і: socket.io.on('reconnect\_attempt', ...), не на самому socket.
4.  В SSE після writeHead перший res.write('retry: 1000\\n\\n') задає темп реконекту клієнта — без нього дефолт кількасекундний і демо «висне».
5.  Не тримай буфер подій у gateway: винеси в окремий provider (наприклад, OrderEventsService із Subject\-ом усередині) — його ж використає і SSE-контролер. Одна шина — два транспорти.
6.  @nestjs/platform-express мусить лишатися в залежностях: без нього NestFactory.create падає з «No driver (HTTP) has been selected».

  

Зв'язок з курсовим проєктом

  

Це ДЗ #8 з мапи курсового: realtime-шар твого Marketplace API. Шина подій, яку ти зробиш (Subject + emit у кімнати), — це та сама точка, куди на Лекції 19 підключиться RabbitMQ («order placed» піде в чергу, а споживач черги — емітити в кімнати), а на Лекції 23 Redis-адаптер зробить кімнати кластерними. Захист (Лекція 34) виграє від живого демо: два браузери, зміна статусу, миттєва нотифікація.
