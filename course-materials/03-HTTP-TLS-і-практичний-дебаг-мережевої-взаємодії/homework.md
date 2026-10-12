# HTTP, TLS і практичний дебаг мережевої взаємодії

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104309
Отримано: 2026-10-12T13:39:38.834Z

## Домашнє завдання

LMS ID: 54337

**Постановка**

Ви будуєте HTTP-сервер «з нуля» — без фреймворка і без модуля http. Мета — побачити, що HTTP/1.1 — це просто текст поверх TCP: ви самі приймаєте байти з сокета, розбираєте request-line та заголовки і самі формуєте валідну відповідь.

Це той рівень, який http.createServer зазвичай ховає від вас. Але на роботі саме він і потрібен: коли треба зрозуміти, «чому клієнт бачить 400», прочитати вивід curl -v або Wireshark, з'ясувати, звідки беруться Content-Length, Connection: keep-alive і статус-рядок.

  

**Що потрібно зробити**

**1\. HTTP-сервер на** **net.createServer()**

Без require('http') — приймаєте сирі байти з TCP-сокета.

**2\. Парсер request**

Витягує з вхідного тексту method, path і мапу headers (ключі нормалізовані до lower-case).

**3\. Роутинг і валідні відповіді**

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-color-#000000 ql-bg-transparent">Запит</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-color-#000000 ql-bg-transparent">Відповідь</strong></td></tr><tr><td data-row="2"><span class="ql-color-#188038 ql-bg-transparent">GET /</span></td><td data-row="2"><span class="ql-color-#188038 ql-bg-transparent">200 OK</span><span class="ql-bg-transparent ql-color-#000000"> (</span><span class="ql-bg-transparent ql-color-#188038">Content-Type: text/plain</span><span class="ql-bg-transparent ql-color-#000000">)</span></td></tr><tr><td data-row="3"><span class="ql-color-#188038 ql-bg-transparent">GET /headers</span></td><td data-row="3"><span class="ql-color-#000000 ql-bg-transparent">розпарсені заголовки запиту</span></td></tr><tr><td data-row="4"><span class="ql-color-#000000 ql-bg-transparent">будь-що інше</span></td><td data-row="4"><span class="ql-color-#188038 ql-bg-transparent">404 Not Found</span></td></tr></tbody></table>

Кожна відповідь — коректний HTTP/1.1: статус-рядок, Content-Type, Content-Length, порожній рядок, тіло.

**4\. HTTPS-варіант**

На tls.createServer() (без require('https')), із самопідписаним сертифікатом (openssl req -x509). Переюзає той самий обробник запиту.

**5\. Debug-сесія**

У README.md вклейте вивід openssl s\_client -connect localhost:3443 із рядком verify error (для self-signed він очікуваний) і одним реченням поясніть, що це за код помилки:

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-color-#000000 ql-bg-transparent">Код</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-color-#000000 ql-bg-transparent">Значення</strong></td></tr><tr><td data-row="2"><span class="ql-color-#188038 ql-bg-transparent">18</span></td><td data-row="2"><span class="ql-color-#000000 ql-bg-transparent">self-signed</span></td></tr><tr><td data-row="3"><span class="ql-color-#188038 ql-bg-transparent">19</span></td><td data-row="3"><span class="ql-color-#000000 ql-bg-transparent">chain incomplete</span></td></tr><tr><td data-row="4"><span class="ql-color-#188038 ql-bg-transparent">10</span></td><td data-row="4"><span class="ql-color-#000000 ql-bg-transparent">expired</span></td></tr></tbody></table>

**Обмеження.** Стартуєте з порожнього репозиторію — весь код ваш. Стандартна бібліотека Node (net, tls, fs, crypto) дозволена, сторонні npm-залежності — ні.

  

**Acceptance criteria**

1.  \[ \] **Без** **http****/****https****.** Жоден файл у src/ не імпортує http чи https: grep -REn "(require\\(|from )\['\\"\](node:)?https?\['\\"\]" src/ не дає жодного збігу, а grep -n "net.createServer" src/server.js і grep -n "tls.createServer" src/https-server.js — дають по збігу.
2.  \[ \] **Плейн-сервер відповідає коректно.** curl -sv [http://localhost:3000/](http://localhost:3000/) → перший рядок HTTP/1.1 200 OK і хедер Content-Type: text/plain. curl -s -o /dev/null -w "%{http\_code}\\n" [http://localhost:3000/nope](http://localhost:3000/nope) виводить 404.
3.  \[ \] **Парсер заголовків працює.** curl -s [http://localhost:3000/headers](http://localhost:3000/headers) -H "X-Demo: abc" повертає тіло, у якому присутні рядки host: і x-demo: abc (ключі в lower-case) — тобто method/path/headers реально розпарсені у структуру, а не захардкоджені.
4.  \[ \] **HTTPS-варіант піднімається на самопідписаному серті.** curl -sk -o /dev/null -w "%{http\_code}\\n" [https://localhost:3443/](https://localhost:3443/) виводить 200. Команда генерації сертифіката (openssl req -x509 -newkey rsa:2048 -nodes ...) присутня в README.md, а самі \*.pem / \*.key — у .gitignore (не закомічені).
5.  \[ \] **Debug-сесія задокументована.** README.md містить блок виводу openssl s\_client -connect localhost:3443 -servername localhost із рядком, що матчить grep -E "verify (error|return code)" README.md, і одне речення з поясненням коду помилки self-signed.

  

**Формат здачі**

**Репозиторій:** публічний GitHub-репозиторій (або гілка hw-03 у наявному навчальному репо) + Pull Request.

**Структура:**

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-color-#000000 ql-bg-transparent">Файл</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-color-#000000 ql-bg-transparent">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-color-#188038 ql-bg-transparent">src/server.js</span></td><td data-row="2"><span class="ql-color-#000000 ql-bg-transparent">raw HTTP на </span><span class="ql-bg-transparent ql-color-#188038">net</span></td></tr><tr><td data-row="3"><span class="ql-color-#188038 ql-bg-transparent">src/https-server.js</span></td><td data-row="3"><span class="ql-color-#000000 ql-bg-transparent">HTTPS на </span><span class="ql-bg-transparent ql-color-#188038">tls</span><span class="ql-bg-transparent ql-color-#000000"> (переюзає парсер/обробник із </span><span class="ql-bg-transparent ql-color-#188038">server.js</span><span class="ql-bg-transparent ql-color-#000000">)</span></td></tr><tr><td data-row="4"><span class="ql-color-#188038 ql-bg-transparent">README.md</span></td><td data-row="4"><span class="ql-color-#000000 ql-bg-transparent">команди запуску обох серверів, команда генерації self-signed сертифіката, вклеєний вивід </span><span class="ql-bg-transparent ql-color-#188038">openssl s_client</span><span class="ql-bg-transparent ql-color-#000000"> з поясненням </span><span class="ql-bg-transparent ql-color-#188038">verify error</span></td></tr><tr><td data-row="5"><span class="ql-color-#188038 ql-bg-transparent">.gitignore</span></td><td data-row="5"><span class="ql-color-#000000 ql-bg-transparent">виключає згенеровані </span><span class="ql-bg-transparent ql-color-#188038">*.pem</span><span class="ql-bg-transparent ql-color-#000000"> / </span><span class="ql-bg-transparent ql-color-#188038">*.key</span></td></tr></tbody></table>

**Вимога до README:** грейдер має змогти запустити все двома командами (node src/server.js, node src/https-server.js) — без вгадування портів чи прапорців.

**У LMS здаєте посилання на PR**, не на головну гілку.

  

**Зв'язок з курсовим проєктом**

Це **foundation-ДЗ поза курсовим проєктом** — воно нічого не додає до Marketplace API.

Його ціль — вибудувати ментальну модель HTTP/TLS на рівні байтів і сокетів. Щоб пізніше, працюючи з Express/Fastify (Лекція 4) і NestJS-шаром, ви розуміли, що саме фреймворк робить за вас, і могли дебажити мережеві та TLS-проблеми через curl -v та openssl s\_client, а не лише через логи фреймворка.

Навички звідси — читання raw request, self-signed сертифікати, коди verify error — прямо перевикористовуються у Лекції 27 (Security hardening, mTLS).
