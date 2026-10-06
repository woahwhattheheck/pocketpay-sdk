import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as configModule from '../src/config';
import { pollTransaction } from '../src/transactions/polling';

const HASH = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const CONFIRMED = {
  hash: HASH,
  ledger_attr: 102,
  created_at: '2023-01-01T00:00:00Z',
  source_account: 'GABC',
  fee_charged: '100',
  operation_count: 1,
  successful: true,
};

function installLookup(call: ReturnType<typeof vi.fn>): void {
  vi.spyOn(configModule, 'getHorizonServer').mockReturnValue({
    transactions: () => ({ transaction: () => ({ call }) }),
  } as any);
}

describe('pollTransaction request and cancellation lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns timeout at the deadline even when the lookup never settles', async () => {
    const controller = new AbortController();
    const call = vi.fn(() => new Promise<typeof CONFIRMED>(() => {}));
    installLookup(call);
    let observed: Awaited<ReturnType<typeof pollTransaction>> | undefined;
    const completed = pollTransaction(HASH, { timeout: 40, signal: controller.signal })
      .then(result => { observed = result; }, () => {});

    try {
      await vi.advanceTimersByTimeAsync(40);
      expect(observed).toMatchObject({ status: 'timeout', state: 'unknown', attempts: 1 });
      expect(call).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.abort();
      await completed;
    }
  });

  it('ignores a confirmation that arrives after the deadline', async () => {
    const call = vi.fn(() => new Promise<typeof CONFIRMED>(resolve => {
      setTimeout(() => resolve(CONFIRMED), 60);
    }));
    installLookup(call);
    const completed = pollTransaction(HASH, { timeout: 40 });

    await vi.advanceTimersByTimeAsync(60);
    expect(await completed).toMatchObject({ status: 'timeout', state: 'unknown', attempts: 1 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the last pending observation when the next lookup hangs', async () => {
    const controller = new AbortController();
    const call = vi.fn()
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockImplementationOnce(() => new Promise<typeof CONFIRMED>(() => {}));
    installLookup(call);
    let observed: Awaited<ReturnType<typeof pollTransaction>> | undefined;
    const completed = pollTransaction(HASH, { interval: 10, timeout: 40, signal: controller.signal })
      .then(result => { observed = result; }, () => {});

    try {
      await vi.advanceTimersByTimeAsync(40);
      expect(observed).toMatchObject({ status: 'timeout', state: 'pending', attempts: 2 });
      expect(call).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.abort();
      await completed;
    }
  });

  it('cancels an in-flight lookup and handles its later rejection', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    let rejectLookup!: (error: Error) => void;
    const call = vi.fn(() => new Promise<typeof CONFIRMED>((_resolve, reject) => {
      rejectLookup = reject;
    }));
    installLookup(call);
    const completed = pollTransaction(HASH, { interval: 10, timeout: 40, signal: controller.signal })
      .then(() => undefined, error => error);

    controller.abort();
    expect(await completed).toMatchObject({ name: 'AbortError' });
    rejectLookup(new Error('late transport rejection'));
    await vi.advanceTimersByTimeAsync(100);
    expect(call).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels during the retry delay and removes its timer and listener', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const call = vi.fn().mockRejectedValue({ status: 404 });
    installLookup(call);
    const completed = pollTransaction(HASH, { interval: 10, timeout: 40, signal: controller.signal })
      .then(() => undefined, error => error);

    await vi.advanceTimersByTimeAsync(5);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(await completed).toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    expect(call).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('normalizes a positive fractional attempt bound to at least one lookup', async () => {
    const call = vi.fn().mockResolvedValue(CONFIRMED);
    installLookup(call);
    expect(await pollTransaction(HASH, { maxAttempts: 0.5, timeout: 40 }))
      .toMatchObject({ status: 'success', state: 'confirmed', attempts: 1 });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('normalizes a positive fractional timeout to at least one millisecond', async () => {
    const call = vi.fn().mockResolvedValue(CONFIRMED);
    installLookup(call);
    expect(await pollTransaction(HASH, { timeout: 0.5 }))
      .toMatchObject({ status: 'success', state: 'confirmed', attempts: 1 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('normalizes a positive fractional interval so retries have a real delay', async () => {
    const call = vi.fn().mockRejectedValue({ status: 404 });
    installLookup(call);
    const completed = pollTransaction(HASH, { interval: 0.5, timeout: 3, maxAttempts: 5 });

    await vi.advanceTimersByTimeAsync(3);
    expect(await completed).toMatchObject({ status: 'timeout', state: 'pending', attempts: 3 });
    expect(call).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes deadline and abort resources after a prompt confirmation', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const call = vi.fn().mockResolvedValue(CONFIRMED);
    installLookup(call);

    expect(await pollTransaction(HASH, { timeout: 40, signal: controller.signal }))
      .toMatchObject({ status: 'success', state: 'confirmed', attempts: 1 });
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('polls through the public SDK export without a submission path', async () => {
    const call = vi.fn().mockResolvedValue(CONFIRMED);
    installLookup(call);
    const sdk = await import('../src');

    expect(await sdk.pollTransaction(HASH, { timeout: 40 }))
      .toMatchObject({ status: 'success', state: 'confirmed', attempts: 1 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns timeout when a synchronous lookup failure crosses the deadline', async () => {
    const call = vi.fn(() => {
      vi.setSystemTime(Date.now() + 41);
      throw { status: 400, message: 'late lookup failure' };
    });
    installLookup(call);

    expect(await pollTransaction(HASH, { timeout: 40 }))
      .toMatchObject({ status: 'timeout', state: 'unknown', attempts: 1 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores confirmation after a clock advance before deadline timer delivery', async () => {
    const call = vi.fn(() => {
      vi.setSystemTime(Date.now() + 41);
      return Promise.resolve(CONFIRMED);
    });
    installLookup(call);

    expect(await pollTransaction(HASH, { timeout: 40 }))
      .toMatchObject({ status: 'timeout', state: 'unknown', attempts: 1 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let Node timer overflow expire a long timeout immediately', async () => {
    vi.useRealTimers();
    const call = vi.fn(() => new Promise<typeof CONFIRMED>(resolve => {
      setTimeout(() => resolve(CONFIRMED), 12);
    }));
    installLookup(call);

    expect(await pollTransaction(HASH, { timeout: 2147483648 }))
      .toMatchObject({ status: 'success', state: 'confirmed', attempts: 1 });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('does not let Node timer overflow schedule a long retry delay immediately', async () => {
    vi.useRealTimers();
    const controller = new AbortController();
    const call = vi.fn()
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce(CONFIRMED);
    installLookup(call);
    const abortTimer = setTimeout(() => controller.abort(), 20);
    try {
      await expect(pollTransaction(HASH, {
        interval: 2147483648,
        timeout: 4294967296,
        maxAttempts: 2,
        signal: controller.signal,
      })).rejects.toMatchObject({ name: 'AbortError' });
      expect(call).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(abortTimer);
      controller.abort();
    }
  });
});
