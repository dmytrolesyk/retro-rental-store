import pg from 'pg';

const POSTGRES_INVALID_PASSWORD_CODE = '28P01';

type ConnectCallback = Parameters<pg.Pool['connect']>[0];

// Only acquiring a connection is retried. Queries and transactions are untouched.
export class RotationPool extends pg.Pool {
  connect(): Promise<pg.PoolClient>;
  connect(callback: ConnectCallback): void;
  connect(callback?: ConnectCallback): Promise<pg.PoolClient> | void {
    const connection = this.connectWithRetry();
    if (!callback) return connection;
    void connection.then(
      client => {
        callback(undefined, client, (error?: Error | boolean) => {
          client.release(error);
        });
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), undefined, () => {});
      },
    );
  }

  private async connectWithRetry(): Promise<pg.PoolClient> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await super.connect();
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== POSTGRES_INVALID_PASSWORD_CODE ||
          attempt >= 3
        ) {
          throw error;
        }
        // Allow the rotator to publish the new password before trying again.
        await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
      }
    }
  }
}
