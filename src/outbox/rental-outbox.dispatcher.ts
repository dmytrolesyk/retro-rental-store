import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { Env } from '../config/env.schema';
import { OutboxRepository } from './outbox.repository';
import { OUTBOX_BATCH_SIZE, ProcessRentalOutbox } from './process-rental-outbox';

export const OUTBOX_RESCAN_MS = 30000;
const MIN_RETRY_WAKE_MS = 1000;

/** Single API process: signals reduce latency; persisted rows and timers provide recovery. */
@Injectable()
export class RentalOutboxDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RentalOutboxDispatcher.name);
  private requested = false;
  private stopping = false;
  private active: Promise<void> | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly processRentalOutboxUseCase: ProcessRentalOutbox,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  onApplicationBootstrap(): void {
    this.wake();
  }

  /** Fire-and-forget hint. Never await processing in the business transaction callback. */
  wake(): void {
    if (!this.canRun()) return;
    this.requested = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.active) return;
    this.active = Promise.resolve()
      .then(() => this.drain())
      .catch(() => {
        this.logger.error('Outbox scan failed; pending deliveries retained');
        this.schedule(OUTBOX_RESCAN_MS);
      })
      .finally(() => {
        this.active = null;
        // A commit can arrive during retry planning or while the current flight settles.
        if (this.requested && !this.stopping) this.wake();
      });
  }

  async waitForIdle(): Promise<void> {
    while (this.active) await this.active;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.requested = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.waitForIdle();
  }

  private async drain(): Promise<void> {
    while (this.requested && this.canRun()) {
      this.requested = false;
      const result = await this.processRentalOutboxUseCase.execute();
      if (result.failed)
        this.logger.warn(
          `${String(result.failed)} outbox delivery attempts failed; retained for retry`,
        );
      const attempted = result.emailQueued + result.realtimePublished + result.failed;
      if (attempted >= OUTBOX_BATCH_SIZE) this.requested = true;
      if (this.requested && !this.stopping) await yieldToEventLoop();
    }
    if (!this.canRun()) return;
    const retryDelayMs = await this.outboxRepository.nextRetryDelayMs();
    if (this.requested) return;
    const delayMs = Math.min(
      OUTBOX_RESCAN_MS,
      Math.max(MIN_RETRY_WAKE_MS, retryDelayMs ?? OUTBOX_RESCAN_MS),
    );
    this.schedule(delayMs);
  }

  private schedule(delayMs: number): void {
    if (!this.canRun() || this.requested) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.wake();
    }, delayMs);
    this.timer.unref();
  }

  private canRun(): boolean {
    return !this.stopping && this.configService.get('RENTAL_OUTBOX_ENABLED', { infer: true });
  }
}
