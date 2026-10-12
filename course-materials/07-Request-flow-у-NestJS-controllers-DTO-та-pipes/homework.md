# Request flow у NestJS: controllers, DTO та pipes

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104313
Отримано: 2026-10-12T13:40:48.074Z

## Домашнє завдання

LMS ID: 54340

Ви продовжуєте **свій** mini-Nest із ДЗ #6. Тепер контейнер має не просто створювати об'єкти, а **обслуговувати HTTP-запити**: ви будуєте маршрутизацію на декораторах і валідацію вхідних даних.

Це **частина 2 з 3**. Стартова точка — гілка part-1-ioc. Якщо ДЗ #6 не здане, візьміть еталонну реалізацію з демо Лекції 6 і чесно вкажіть це в README.

**Що потрібно зробити**

**1\.** **@Controller(prefix)**

Декоратор класу, що записує базовий шлях у метадані.

**2\.** **@Get(path)** **/** **@Post(path)**

Декоратори методів, що реєструють маршрут. Повний шлях = префікс контролера + шлях методу.

**3\. Параметр-декоратори** **@Body()****,** **@Param(name)****,** **@Query(name)**

Вони не витягують дані самі — вони **записують у метадані**, який аргумент звідки брати. Дістає значення вже ваш диспетчер під час виклику.

**4\. Диспетчер поверх** **node:http**

Приймає запит, знаходить маршрут, збирає масив аргументів за метаданими параметрів, викликає метод контролера через контейнер із ДЗ #6, серіалізує результат у JSON.

**5\. DTO + валідація через простий Pipe**

Клас DTO з правилами — через class-validator **або** власні декоратори, на ваш вибір, обидва варіанти приймаються.

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Тіло запиту</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Результат</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">невалідне</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">400</span><span class="ql-bg-transparent ql-color-#000000"> з переліком полів і причин</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">валідне</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">у метод приходить </span><strong class="ql-bg-transparent ql-color-#000000">екземпляр DTO</strong><span class="ql-bg-transparent ql-color-#000000">, а не сирий об'єкт</span></td></tr></tbody></table>

**6\. Тести обов'язкові**

Мінімум: маршрут знаходиться, @Param і @Query підставляються, невалідний DTO дає 400 із деталями, валідний доходить до методу.

**Обмеження.** Дозволено: reflect-metadata, class-validator + class-transformer, тест-раннер, supertest або вбудований fetch для HTTP-тестів. Заборонено: @nestjs/\*, express, fastify — маршрутизація ваша, поверх node:http.

**Підказки, які економлять години.** Параметр-декоратор отримує (target, propertyKey, parameterIndex) — індекс і є ключем: зберіть мапу { \[index\]: { type: 'body' | 'param' | 'query', name } } у метаданих методу, а під час виклику побудуйте масив аргументів за цією мапою. Порядок декораторів: параметр-декоратори виконуються до декоратора методу, а той — до декоратора класу; якщо покладаєтесь на порядок, переконайтеся тестом. class-validator працює з екземплярами, не з plain-об'єктами: спершу plainToInstance(Dto, body), тоді validate(instance) — без першого кроку валідатор мовчки нічого не перевірить. Тіло POST у node:http не парситься саме: зберіть чанки з req.on('data') і зробіть JSON.parse у req.on('end') — це той самий код, що й на Лекції 3. Помилку валідації віддавайте списком \[{ field, constraints }\], а не першим полем.

**Acceptance criteria**

1.  \[ \] **Фреймворків немає.** grep -RE "@nestjs|express|fastify" package.json src/ не дає збігів.
2.  \[ \] **Маршрути з декораторів, не з масиву.** grep -rn "Reflect.getMetadata" src/ показує читання метаданих маршрутів; у коді немає захардкодженого списку шляхів.
3.  \[ \] **Префікс склеюється.** Контролер із @Controller('users') і метод із @Get(':id') відповідають на GET /users/42 (тест або curl).
4.  \[ \] **@Param** **працює.** GET /users/42 повертає тіло, що містить 42, і в коді метод приймає його **аргументом**, а не читає з req вручну.
5.  \[ \] **@Query** **працює.** GET /users?limit=5 — значення 5 доходить до методу окремим аргументом.
6.  \[ \] **@Body** **працює.** POST /users з JSON-тілом — у метод приходить розпарсений об'єкт.
7.  \[ \] **Валідація відхиляє.** POST /users з {"email":"not-an-email"} → HTTP 400, і тіло відповіді містить назву поля email (відповідь матчить /email/).
8.  \[ \] **Валідація пропускає.** Коректне тіло → 201 або 200, і в обробник приходить **екземпляр класу DTO** (тест перевіряє body instanceof CreateUserDto).
9.  \[ \] **Контейнер із частини 1 задіяно.** Контролер отримує сервіс через конструктор, і сервіс створює саме контейнер (тест на те, що це той самий singleton).
10.  \[ \] **Тести проходять.** npm test — код 0, щонайменше 6 пройдених тестів.
11.  \[ \] **Працює в Docker.** docker compose run --rm api npm test проходить.

**Формат здачі**

**Репозиторій:** той самий mini-nest, Pull Request із гілки part-2-http.

**Структура** (додається до частини 1):

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Файл</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">src/decorators/controller.ts</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">@Controller(prefix)</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">src/decorators/methods.ts</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">@Get</span><span class="ql-bg-transparent ql-color-#000000"> / </span><span class="ql-bg-transparent ql-color-#188038">@Post</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#188038">src/decorators/params.ts</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#188038">@Body</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#188038">@Param</span><span class="ql-bg-transparent ql-color-#000000">, </span><span class="ql-bg-transparent ql-color-#188038">@Query</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#188038">src/router.ts</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#000000">збір маршрутів із метаданих</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#188038">src/dispatcher.ts</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#000000">HTTP-шар поверх </span><span class="ql-bg-transparent ql-color-#188038">node:http</span></td></tr><tr><td data-row="7"><span class="ql-bg-transparent ql-color-#188038">src/pipes/validation.pipe.ts</span></td><td data-row="7"><span class="ql-bg-transparent ql-color-#000000">валідація DTO</span></td></tr><tr><td data-row="8"><span class="ql-bg-transparent ql-color-#188038">src/dto/create-user.dto.ts</span></td><td data-row="8"><span class="ql-bg-transparent ql-color-#000000">DTO з правилами</span></td></tr><tr><td data-row="9"><span class="ql-bg-transparent ql-color-#188038">test/</span></td><td data-row="9"><span class="ql-bg-transparent ql-color-#000000">тести</span></td></tr><tr><td data-row="10"><span class="ql-bg-transparent ql-color-#188038">README.md</span></td><td data-row="10"><span class="ql-bg-transparent ql-color-#000000">доповнити абзацом «як параметр-декоратор знає, куди підставити значення»</span></td></tr></tbody></table>

**У LMS здаєте посилання на PR**, не на головну гілку.

**Зв'язок з курсовим проєктом**

Це **training-артефакт поза курсовим проєктом**. Але патерн, який ви тут пишете руками, — рівно те, що робить NestJS у @nestjs/platform-express.

На Лекції 8 ви додасте у цей же диспетчер повний lifecycle (middleware → guard → interceptor → pipe → handler → filter) і побачите, що всі ці поняття — просто точки у вашому власному циклі, а не окремі сутності фреймворка.

Далі, у Лекції 9 (API design), ці DTO стануть контрактом реального Marketplace API.
