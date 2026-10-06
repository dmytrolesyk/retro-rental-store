import { AbstractLogger } from 'typeorm';
import type { LogLevel, LogMessage } from 'typeorm';

export class QueryCountLogger extends AbstractLogger {
  count = 0;
  echo = false;

  constructor() {
    super(['query']);
  }

  reset(): void {
    this.count = 0;
  }

  protected writeLog(_level: LogLevel, messages: LogMessage | LogMessage[]): void {
    for (const message of Array.isArray(messages) ? messages : [messages]) {
      if (message.type !== 'query') continue;
      this.count += 1;
      if (this.echo) {
        const parameters = message.parameters?.length
          ? ` -- parameters: ${JSON.stringify(message.parameters)}`
          : '';
        console.log(`SQL#${String(this.count)}: ${String(message.message)}${parameters}`);
      }
    }
  }
}
