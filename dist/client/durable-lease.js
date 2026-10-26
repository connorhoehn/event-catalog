"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DurableLease = void 0;
/** One acquired delivery. Renewals and terminal acknowledgement never overlap. */
class DurableLease {
    client;
    queue;
    visibilityMs;
    timeoutMs;
    receipt;
    deadline;
    renewal;
    expiry;
    renewing;
    terminal = false;
    closed = false;
    cancellation = new AbortController();
    io = new AbortController();
    context;
    constructor(client, queue, message, visibilityMs, acquiredAt, timeoutMs) {
        this.client = client;
        this.queue = queue;
        this.visibilityMs = visibilityMs;
        this.timeoutMs = timeoutMs;
        this.receipt = message.receipt_handle;
        this.deadline = acquiredAt + visibilityMs;
        this.context = {
            signal: this.cancellation.signal,
            messageId: message.message_id,
            receiveCount: message.approximate_receive_count,
        };
        this.arm();
    }
    get active() {
        return (!this.closed &&
            !this.cancellation.signal.aborted &&
            performance.now() < this.deadline);
    }
    clearTimers() {
        clearTimeout(this.renewal);
        clearTimeout(this.expiry);
    }
    abandon(reason = new Error('Delivery lease abandoned')) {
        if (this.closed)
            return;
        this.closed = true;
        this.clearTimers();
        this.cancellation.abort(reason);
        this.io.abort();
    }
    assertActive() {
        if (!this.active) {
            this.abandon(new Error('Delivery lease expired'));
            throw (this.cancellation.signal.reason ?? new Error('Delivery lease closed'));
        }
    }
    requestOptions() {
        this.assertActive();
        return {
            signal: this.io.signal,
            timeoutMs: Math.max(1, Math.min(this.timeoutMs, Math.floor(this.deadline - performance.now()))),
        };
    }
    arm() {
        this.clearTimers();
        if (!this.active) {
            this.abandon(new Error('Delivery lease expired before processing'));
            return;
        }
        this.expiry = setTimeout(() => this.abandon(new Error('Delivery lease expired')), Math.max(1, this.deadline - performance.now()));
        this.expiry.unref?.();
        if (!this.terminal) {
            this.renewal = setTimeout(() => {
                this.renewing = this.renew().finally(() => {
                    this.renewing = undefined;
                });
            }, Math.max(1, this.deadline - performance.now() - (this.visibilityMs * 2) / 3));
            this.renewal.unref?.();
        }
    }
    async renew() {
        try {
            const started = performance.now();
            const result = await this.client.extend(this.queue, this.receipt, this.visibilityMs / 1000, this.requestOptions());
            this.assertActive();
            if (!result.success)
                throw new Error('Delivery lease renewal refused');
            this.receipt = result.new_receipt_handle ?? this.receipt;
            this.deadline = started + this.visibilityMs;
            this.arm();
        }
        catch (error) {
            this.abandon(error);
        }
    }
    async acknowledge() {
        this.terminal = true;
        clearTimeout(this.renewal);
        await this.renewing;
        const success = await this.client.ack(this.queue, this.receipt, this.requestOptions());
        this.assertActive();
        if (!success)
            throw new Error('Delivery acknowledgement refused');
        this.closed = true;
        this.clearTimers();
    }
    /** Bound an uncooperative handler after ownership loss without a late ACK. */
    async run(operation) {
        this.assertActive();
        const signal = this.context.signal;
        let onAbort;
        const cancelled = new Promise((_, reject) => {
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
        }
        finally {
            signal.removeEventListener('abort', onAbort);
        }
    }
}
exports.DurableLease = DurableLease;
//# sourceMappingURL=durable-lease.js.map