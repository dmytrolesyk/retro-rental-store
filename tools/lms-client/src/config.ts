import { fileURLToPath } from 'node:url';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';

export const DEFAULT_COURSE = 5467;
export const DEFAULT_QUALITY = 1080;
// Anchor to the package location rather than the caller's working directory.
export const MATERIALS_ROOT = fileURLToPath(new URL('../../../course-materials/', import.meta.url));

export const COMMANDS = {
  login: 'Інтерактивний вхід у LMS (без пароля в аргументах).',
  logout: 'Очистити локальну сесію.',
  lessons: 'Перелік усіх лекцій курсу.',
  homework: 'Умова домашки вибраної лекції.',
  materials: 'Перелік матеріалів вибраної лекції.',
  sync: 'Зберегти текстовий контекст; відео лише з --video.',
  video: 'Явно завантажити відео вибраної лекції.',
} as const;

type CommandName = keyof typeof COMMANDS;
export interface CommandConfig {
  command: CommandName | 'help';
  help: boolean;
  course: number;
  lesson?: number;
  lessonId?: number;
  latest: boolean;
  video: boolean;
  quality: number;
  mediaId?: number;
  materialsRoot: string;
}

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  course: { type: 'string' },
  lesson: { type: 'string' },
  'lesson-id': { type: 'string' },
  latest: { type: 'boolean' },
  video: { type: 'boolean' },
  quality: { type: 'string' },
  'media-id': { type: 'string' },
} as const satisfies ParseArgsOptionsConfig;

export class ArgumentError extends Error {}

function positiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ArgumentError(`--${name} має бути додатним безпечним цілим числом.`);
  }
  return Number(value);
}

export function parseCommand(args: string[]): CommandConfig {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
      tokens: true,
    });
  } catch {
    // Do not echo raw arguments: a mistaken --password must not leak its value.
    throw new ArgumentError('Невідома опція або відсутнє/неправильне значення. Див. --help.');
  }
  const { values, positionals, tokens } = parsed;
  const command = positionals[0] ?? 'help';
  if (positionals.length > 1 || (command !== 'help' && !Object.hasOwn(COMMANDS, command))) {
    throw new ArgumentError('Невідома команда або зайві позиційні аргументи. Див. --help.');
  }
  const allowed = new Set<string>(['help']);
  if (command !== 'help' && command !== 'login' && command !== 'logout') allowed.add('course');
  if (['homework', 'materials', 'sync', 'video'].includes(command)) {
    for (const name of ['lesson', 'lesson-id', 'latest']) allowed.add(name);
  }
  if (command === 'sync') allowed.add('video');
  if (command === 'video' || command === 'sync') {
    allowed.add('quality');
    allowed.add('media-id');
  }
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (!allowed.has(token.name) || seen.has(token.name)) {
      throw new ArgumentError('Опція не підтримується цією командою або вказана повторно.');
    }
    seen.add(token.name);
  }
  const course = positiveInteger(values.course, 'course') ?? DEFAULT_COURSE;
  const lesson = positiveInteger(values.lesson, 'lesson');
  const lessonId = positiveInteger(values['lesson-id'], 'lesson-id');
  const quality = positiveInteger(values.quality, 'quality') ?? DEFAULT_QUALITY;
  const mediaId = positiveInteger(values['media-id'], 'media-id');
  const help = command === 'help' || values.help === true;
  const selectors =
    Number(lesson !== undefined) + Number(lessonId !== undefined) + Number(values.latest === true);
  if (
    selectors > 1 ||
    (!help && ['homework', 'materials', 'sync', 'video'].includes(command) && selectors !== 1)
  ) {
    throw new ArgumentError('Вибери рівно один із --lesson, --lesson-id, --latest.');
  }
  if (
    command === 'sync' &&
    !values.video &&
    (values.quality !== undefined || mediaId !== undefined)
  ) {
    throw new ArgumentError('--quality і --media-id для sync потребують --video.');
  }
  return {
    command: command as CommandConfig['command'],
    help,
    course,
    lesson,
    lessonId,
    latest: values.latest === true,
    video: command === 'video' || values.video === true,
    quality,
    mediaId,
    materialsRoot: MATERIALS_ROOT,
  };
}

export function helpData(command: CommandConfig['command']) {
  return {
    usage: 'lms <command> [options]',
    command: command === 'help' ? null : command,
    commands: COMMANDS,
    options: {
      '--help, -h': 'Показати довідку у JSON.',
      '--course <id>': 'ID курсу для lessons/homework/materials/sync/video; default 5467.',
      '--lesson <number>': 'Номер лекції; один із трьох селекторів.',
      '--lesson-id <id>': 'Стабільний ID лекції.',
      '--latest': 'Остання опублікована доступна лекція за датою заняття.',
      '--video': 'Лише sync: явно додати завантаження відео.',
      '--quality <height>': 'video або sync --video: висота в пікселях; default 1080.',
      '--media-id <id>': 'video або sync --video: вибрати запис із кількох.',
    },
    defaults: { course: DEFAULT_COURSE, quality: DEFAULT_QUALITY, materialsRoot: MATERIALS_ROOT },
    exitCodes: {
      '0': 'Успіх/довідка',
      '1': 'Внутрішня помилка',
      '2': 'Неправильні аргументи',
      '3': 'Дію ще не реалізовано',
    },
    stage: 'Каркас: дії команд із LMS ще не реалізовані.',
  };
}
