import { ArgumentError, helpData, parseCommand } from './config.js';

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

try {
  const config = parseCommand(process.argv.slice(2));
  if (config.help) {
    writeJson({ ok: true, data: helpData(config.command) });
  } else {
    const message = 'Дію команди ще не реалізовано: доступні довідка та валідація аргументів.';
    writeJson({ ok: false, error: { code: 'NOT_IMPLEMENTED', message } });
    process.stderr.write(`${message}\n`);
    process.exitCode = 3;
  }
} catch (error) {
  const invalidArguments = error instanceof ArgumentError;
  const code = invalidArguments ? 'INVALID_ARGUMENTS' : 'INTERNAL_ERROR';
  const message = invalidArguments ? error.message : 'Внутрішня помилка CLI.';
  writeJson({ ok: false, error: { code, message } });
  process.stderr.write(`${message}\n`);
  process.exitCode = invalidArguments ? 2 : 1;
}
