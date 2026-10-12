# TypeScript decorators і фундамент NestJS

Джерело: https://lms.robotdreams.cc/course/5467/lesson/104312
Отримано: 2026-10-12T13:40:29.227Z

## Домашнє завдання

LMS ID: 54339

**Курсовий проєкт:** ні (наскрізний training-артефакт)

**Постановка**

Ви пишете **власний IoC-контейнер**, який робить те саме, що робить NestJS під капотом: читає метадані типів із конструктора й сам збирає граф залежностей.

Після цієї роботи @Injectable() у Nest перестане бути магією — ви знатимете, що це рівно два рядки Reflect.defineMetadata.

Це **частина 1 з 3**. На Лекції 7 додасте контролери й DTO, на Лекції 8 — pipes, guards, interceptors і фільтри. Пишіть так, щоб було не соромно розширювати.

**Що потрібно зробити**

**1\.** **@Injectable()**

Декоратор класу, що позначає клас як придатний до створення контейнером.

**2\. Резолв за** **design:paramtypes**

Коли клас позначено декоратором і увімкнено emitDecoratorMetadata, TypeScript кладе типи параметрів конструктора у метадані. Ваш контейнер читає їх через Reflect.getMetadata('design:paramtypes', Target) і рекурсивно створює кожну залежність.

**3\.** **@Inject(token)**

Параметр-декоратор для випадків, коли типу недостатньо: інтерфейси в рантаймі не існують, тому для них потрібен явний токен (Symbol або рядок).

**4\. Скоупи**

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Скоуп</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Поведінка</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">singleton</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">за замовчуванням — один екземпляр на контейнер</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">transient</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">новий екземпляр на кожен </span><span class="ql-bg-transparent ql-color-#188038">resolve</span></td></tr></tbody></table>

Скоуп задається аргументом декоратора: @Injectable({ scope: 'transient' }).

**5\. Детекція циклічних залежностей**

A → B → A має падати з **зрозумілою** помилкою, що називає весь ланцюг (A -> B -> A), а не RangeError: Maximum call stack size exceeded.

**6\. Тести обов'язкові**

Мінімум: резолв простого графа, синглтон повертає той самий екземпляр, transient — різні, цикл кидає помилку з ланцюгом, @Inject із токеном працює.

**Обмеження.** Дозволено: reflect-metadata, будь-який тест-раннер (vitest, node:test, jest). Заборонено: @nestjs/\*, inversify, tsyringe, typedi — контейнер ваш. TypeScript беріть **6.x** (npm i -D typescript@6): сьома версія щойно вийшла, для цього ДЗ вона нічого не додає. Код запускається **у контейнері з ДЗ #5**.

**Підказки, які економлять години.** import 'reflect-metadata' — найпершим рядком точки входу й тестового setup-файлу. design:paramtypes з'являється тільки якщо на класі є хоч один декоратор — клас без @Injectable() не отримає метаданих навіть при увімкненому emitDecoratorMetadata. Інтерфейси в метаданих перетворюються на Object — саме тому для них потрібен @Inject(token): це стирання типів, а не обмеження вашої реалізації. Для детекції циклу ведіть Set шляху резолву й передавайте його рекурсивно, а при вході в клас, що вже у шляху, кидайте помилку з \[...path, current\].join(' -> ').

**Acceptance criteria**

1.  \[ \] **Чужих контейнерів немає.** grep -RE "@nestjs|inversify|tsyringe|typedi" package.json src/ не дає жодного збігу.
2.  \[ \] **tsconfig.json** **увімкнув метадані.** Містить "experimentalDecorators": true і "emitDecoratorMetadata": true — grep -E 'experimentalDecorators|emitDecoratorMetadata' tsconfig.json дає два збіги.
3.  \[ \] **Резолв реально через метадані, не через ручний список.** У коді присутній Reflect.getMetadata('design:paramtypes' — grep -rn "design:paramtypes" src/ дає збіг.
4.  \[ \] **Граф збирається рекурсивно.** Тест, у якому A залежить від B, а B від C; container.resolve(A) повертає екземпляр із живим C усередині.
5.  \[ \] **Singleton.** container.resolve(X) === container.resolve(X) → true для класу без явного скоупу.
6.  \[ \] **Transient.** Для класу з @Injectable({ scope: 'transient' }) той самий вираз → false.
7.  \[ \] **@Inject(token)** **працює.** Тест, де залежність зареєстрована під Symbol.for('CONFIG') і резолвиться саме за токеном, а не за типом.
8.  \[ \] **Цикл дає осмислену помилку.** Тест перевіряє, що повідомлення містить назви всіх класів ланцюга (наприклад, матчить /A -> B -> A/) і що це **не** RangeError.
9.  \[ \] **Тести проходять.** npm test завершується з кодом 0, у виводі видно щонайменше 5 пройдених тестів.
10.  \[ \] **Працює в Docker.** docker compose run --rm api npm test проходить (перевикористовуйте образ із ДЗ #5).

**Формат здачі**

**Репозиторій:** публічний GitHub-репозиторій mini-nest (саме він житиме до Лекції 8) + Pull Request із гілки part-1-ioc.

**Структура:**

<table><tbody><tr><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Файл</strong></td><td data-row="1" class="ql-align-center"><strong class="ql-bg-transparent ql-color-#000000">Призначення</strong></td></tr><tr><td data-row="2"><span class="ql-bg-transparent ql-color-#188038">src/decorators/injectable.ts</span></td><td data-row="2"><span class="ql-bg-transparent ql-color-#000000">декоратор </span><span class="ql-bg-transparent ql-color-#188038">@Injectable()</span></td></tr><tr><td data-row="3"><span class="ql-bg-transparent ql-color-#188038">src/decorators/inject.ts</span></td><td data-row="3"><span class="ql-bg-transparent ql-color-#000000">параметр-декоратор </span><span class="ql-bg-transparent ql-color-#188038">@Inject(token)</span></td></tr><tr><td data-row="4"><span class="ql-bg-transparent ql-color-#188038">src/container.ts</span></td><td data-row="4"><span class="ql-bg-transparent ql-color-#000000">сам контейнер</span></td></tr><tr><td data-row="5"><span class="ql-bg-transparent ql-color-#188038">src/tokens.ts</span></td><td data-row="5"><span class="ql-bg-transparent ql-color-#000000">символи-токени</span></td></tr><tr><td data-row="6"><span class="ql-bg-transparent ql-color-#188038">test/</span></td><td data-row="6"><span class="ql-bg-transparent ql-color-#000000">тести</span></td></tr><tr><td data-row="7"><span class="ql-bg-transparent ql-color-#188038">README.md</span></td><td data-row="7"><span class="ql-bg-transparent ql-color-#000000">як запустити + абзац «як це працює»</span></td></tr></tbody></table>

**Вимога до README:** окремий абзац «як це працює» — звідки беруться design:paramtypes і чому без emitDecoratorMetadata нічого не буде.

**У LMS здаєте посилання на PR**, не на головну гілку.

**Зв'язок з курсовим проєктом**

Це **training-артефакт поза курсовим проєктом** — Marketplace API він не стосується.

Його ціль інша: пройти шлях, який пройшли автори Nest, щоб на Лекціях 7–8 бачити не «магічні теги», а знайомий механізм. Коли на Лекції 8 розбиратимемо, чим guard відрізняється від interceptor, ви вже знатимете, де саме в lifecycle вони викликаються, бо самі таке писали.

Готовий mini-Nest — сильний пункт у портфоліо: він показує розуміння рантайм-рефлексії, а не вміння читати документацію.
