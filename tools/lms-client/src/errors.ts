export class ClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode = 1,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const authRequired = () =>
  new ClientError('AUTH_REQUIRED', 'Сесія недоступна. Виконай login повторно.', 4);
