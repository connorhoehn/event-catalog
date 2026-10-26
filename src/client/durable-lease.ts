import type {
  HttpMessageQueue,
  QueueMessage,
} from '@connorhoehnslalom/message-queue/client';

export interface DurableHandlerContext {
  /** Aborted on lease loss or drain expiry. Business writes still need idempotency. */
  readonly signal: AbortSignal;
  readonly messageId: string;
  readonly receiveCount: number;
}

/** One acquired delivery. Renewals and terminal acknowledgement never overlap. */
export class DurableLease {
  private receipt: string;
  private deadline: number;
  private renewal?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  private renewing?: Promise<void>;
  private terminal = false;
  private closed = false;
  private readonly cancellation = new AbortController();
  private readonly io = new AbortController();
  readonly context: DurableHandlerContext;

  constructor(
    private readonly client: Pick<HttpMessageQueue, 'ack' | 'extend'>,
    private readonly queue: string,
    message: QueueMessage,
    private readonly visibilityMs: number,
    acquiredAt: number,
    private readonly timeoutMs: number,
  ) {
    this.receipt = message.receipt_handle;
    this.deadline = acquiredAt + visibilityMs;
    this.context = {
      signal: this.cancellation.signal,
      messageId: message.message_id,
      receiveCount: message.approximate_receive_count,
    };
    this.arm();
  }

  get active(): boolean {
    return (
      !this.closed &&
      !this.cancellation.signal.aborted &&
      performance.now() < this.deadline
    );
  }

  private clearTimers(): void {
    clearTimeout(this.renewal);
    clearTimeout(this.expiry);
  }
  abandon(reason: unknown = new Error('Delivery lease abandoned')): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.cancellation.abort(reason);
    this.io.abort();
  }
  private assertActive(): void {
    if (!this.active) {
      this.abandon(new Error('Delivery lease expired'));
      throw (
        this.cancellation.signal.reason ?? new Error('Delivery lease closed')
      );
    }
  }
  private requestOptions() {
    this.assertActive();
    return {
      signal: this.io.signal,
      timeoutMs: Math.max(
        1,
        Math.min(this.timeoutMs, Math.floor(this.deadline - performance.now())),
      ),
    };
  }
  private arm(): void {
    this.clearTimers();
    if (!this.active) {
      this.abandon(new Error('Delivery lease expired before processing'));
      return;
    }
    this.expiry = setTimeout(
      () => this.abandon(new Error('Delivery lease expired')),
      Math.max(1, this.deadline - performance.now()),
    );
    this.expiry.unref?.();
    if (!this.terminal) {
      this.renewal = setTimeout(
        () => {
          this.renewing = this.renew().finally(() => {
            this.renewing = undefined;
          });
        },
        Math.max(
          1,
          this.deadline - performance.now() - (this.visibilityMs * 2) / 3,
        ),
      );
      this.renewal.unref?.();
    }
  }
  private async renew(): Promise<void> {
    try {
      const started = performance.now();
      const result = await this.client.extend(
        this.queue,
        this.receipt,
        this.visibilityMs / 1000,
        this.requestOptions(),
      );
      this.assertActive();
      if (!result.success) throw new Error('Delivery lease renewal refused');
      this.receipt = result.new_receipt_handle ?? this.receipt;
      this.deadline = started + this.visibilityMs;
      this.arm();
    } catch (error) {
      this.abandon(error);
    }
  }
  async acknowledge(): Promise<void> {
    this.terminal = true;
    clearTimeout(this.renewal);
    await this.renewing;
    const success = await this.client.ack(
      this.queue,
      this.receipt,
      this.requestOptions(),
    );
    this.assertActive();
    if (!success) throw new Error('Delivery acknowledgement refused');
    this.closed = true;
    this.clearTimers();
  }
  /** Bound an uncooperative handler after ownership loss without a late ACK. */
  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.assertActive();
    const signal = this.context.signal;
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          this.assertActive();
          return operation();
        }),
        cancelled,
      ]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
