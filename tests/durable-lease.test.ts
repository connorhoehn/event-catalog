import { afterEach, expect, it, vi } from 'vitest';
import { DurableLease } from '../src/client/durable-lease';

const message = {
  message_id: 'm1',
  receipt_handle: 'initial',
  body: '{}',
  approximate_receive_count: 2,
};
const leases: DurableLease[] = [];
function create(client: ConstructorParameters<typeof DurableLease>[0]) {
  const lease = new DurableLease(
    client,
    'work',
    message,
    3000,
    performance.now(),
    1000,
  );
  leases.push(lease);
  return lease;
}
afterEach(() => {
  for (const lease of leases.splice(0)) lease.abandon();
  vi.useRealTimers();
});

it('serializes acknowledgement after a pending renewal and uses the rotated receipt', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let finish!: (value: {
    success: boolean;
    new_receipt_handle: string;
  }) => void;
  const client = {
    ack: vi.fn(async () => true),
    extend: vi.fn(
      () =>
        new Promise<{ success: boolean; new_receipt_handle: string }>(
          (resolve) => {
            finish = resolve;
          },
        ),
    ),
  };
  const lease = create(client);
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.extend).toHaveBeenCalledOnce();
  const ack = lease.acknowledge();
  expect(client.ack).not.toHaveBeenCalled();
  finish({ success: true, new_receipt_handle: 'rotated' });
  await ack;
  expect(client.ack).toHaveBeenCalledWith(
    'work',
    'rotated',
    expect.any(Object),
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(client.extend).toHaveBeenCalledOnce();
  expect(lease.active).toBe(false);
});

it('bounds an uncooperative handler on renewal loss and forbids late acknowledgement', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const client = {
    ack: vi.fn(async () => true),
    extend: vi.fn(async () => ({ success: false })),
  };
  const lease = create(client);
  let complete!: () => void;
  const result = lease.run(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const rejected = expect(result).rejects.toThrow('renewal refused');
  await vi.advanceTimersByTimeAsync(1000);
  await rejected;
  expect(lease.context.signal.aborted).toBe(true);
  complete();
  await expect(lease.acknowledge()).rejects.toThrow('renewal refused');
  expect(client.ack).not.toHaveBeenCalled();
});

it('expires a lease even when renewal never settles', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const lease = create({
    ack: vi.fn(async () => true),
    extend: vi.fn(() => new Promise(() => {})),
  });
  const result = expect(
    lease.run(() => new Promise<void>(() => {})),
  ).rejects.toThrow('expired');
  await vi.advanceTimersByTimeAsync(3000);
  await result;
  expect(lease.active).toBe(false);
  expect(lease.context).toMatchObject({ messageId: 'm1', receiveCount: 2 });
});

it('does not start a queued handler after cancellation', async () => {
  const handler = vi.fn(async () => {});
  const lease = create({
    ack: vi.fn(async () => true),
    extend: vi.fn(async () => ({ success: true })),
  });
  const result = lease.run(handler);
  lease.abandon(new Error('drained'));
  await expect(result).rejects.toThrow('drained');
  expect(handler).not.toHaveBeenCalled();
});
