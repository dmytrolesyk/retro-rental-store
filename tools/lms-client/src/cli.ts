import { ArgumentError, helpData, parseCommand } from './config.js';
import { AuthClient } from './auth.js';
import { ClientError } from './errors.js';
import { readCredentials } from './prompt.js';
import { GraphqlClient } from './graphql.js';
import { listLessons, selectLesson } from './lessons.js';
import { getHomework } from './homework.js';

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

try {
  const config = parseCommand(process.argv.slice(2));
  if (config.help) {
    writeJson({ ok: true, data: helpData(config.command) });
  } else if (config.command === 'login') {
    const client = new AuthClient();
    if (config.check) {
      process.stderr.write('Оновлюю сесію та перевіряю доступ до курсу…\n');
      writeJson({ ok: true, data: await client.checkSession() });
    } else {
      const credentials = await readCredentials();
      process.stderr.write('Виконую вхід…\n');
      writeJson({ ok: true, data: await client.login(credentials) });
    }
  } else if (config.command === 'logout') {
    writeJson({ ok: true, data: await new AuthClient().logout() });
  } else if (config.command === 'lessons' || config.command === 'homework') {
    const client = new GraphqlClient();
    const result = await listLessons(client, config.course);
    writeJson({
      ok: true,
      data:
        config.command === 'lessons'
          ? result
          : await getHomework(client, config.course, selectLesson(result.lessons, config)),
    });
  } else {
    const message = 'Дію команди ще не реалізовано: доступні довідка та валідація аргументів.';
    writeJson({ ok: false, error: { code: 'NOT_IMPLEMENTED', message } });
    process.stderr.write(`${message}\n`);
    process.exitCode = 3;
  }
} catch (error) {
  const invalidArguments = error instanceof ArgumentError;
  const known = error instanceof ClientError;
  const code = invalidArguments ? 'INVALID_ARGUMENTS' : known ? error.code : 'INTERNAL_ERROR';
  const message = invalidArguments || known ? error.message : 'Внутрішня помилка CLI.';
  writeJson({ ok: false, error: { code, message } });
  process.stderr.write(`${message}\n`);
  process.exitCode = invalidArguments ? 2 : known ? error.exitCode : 1;
}
