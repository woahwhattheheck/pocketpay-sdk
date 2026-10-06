import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const guard = createRequire(import.meta.url)('./network-deny.cjs');
const root = process.env.SDK333_PEER_SOURCE!;
const config = await import(root + '/src/config/index.ts');
const { pollTransaction } = await import(root + '/src/transactions/polling.ts');
const HASH = 'd'.repeat(64);
const RECORD = {
  hash: HASH, ledger_attr: 230, created_at: '2026-10-05T00:00:00Z',
  source_account: 'GTEST_FIXTURE', fee_charged: '100', operation_count: 1,
  successful: true,
};

function install(call: ReturnType<typeof vi.fn>) {
  const transaction = vi.fn((hash: string) => {
    expect(hash).toBe(HASH);
    return { call };
  });
  const write = vi.fn(() => { throw new Error('Unexpected SDK mutation'); });
  const transactions = vi.fn(() => ({ transaction }));
  vi.spyOn(config, 'getHorizonServer').mockReturnValue({
    transactions, submitTransaction: write, accounts: write,
  } as any);
  return { transaction, transactions, write };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

describe('independent polling deadlines and callable bounds', () => {
  afterAll(() => {
    expect(guard.loaded).toBe(true);
    expect(Object.values(guard.counts)).toEqual([0, 0, 0, 0, 0, 0]);
    writeFileSync(process.env.SDK333_PEER_NETWORK_RECEIPT!, JSON.stringify({
      pid: process.pid, source: root, guardLoadedBeforeSubjectImport: true,
      counts: guard.counts,
    }, null, 2) + '\n');
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('terminates a hung first read with an epoch-zero clock and releases its abort listener', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const call = vi.fn(() => new Promise(() => {}));
    const server = install(call);
    let result: any;
    const done = pollTransaction(HASH, { timeout: 7, signal: controller.signal })
      .then((value: any) => { result = value; }, () => {});
    try {
      await vi.advanceTimersByTimeAsync(7);
      expect(result).toMatchObject({ status: 'timeout', state: 'unknown', attempts: 1 });
      expect(call).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
      expect(server.write).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { controller.abort(); await done; }
  });

  for (const lateKind of ['confirmed', 'nonretryable rejection'] as const) {
    it('keeps the pending timeout after a late ' + lateKind, async () => {
      const controller = new AbortController();
      const read = deferred<typeof RECORD>();
      const call = vi.fn().mockRejectedValueOnce({ status: 404 }).mockReturnValueOnce(read.promise);
      const server = install(call);
      let result: any;
      const done = pollTransaction(HASH, { interval: 2, timeout: 7, maxAttempts: 4, signal: controller.signal })
        .then((value: any) => { result = value; }, () => {});
      try {
        await vi.advanceTimersByTimeAsync(7);
        expect(result).toMatchObject({ status: 'timeout', state: 'pending', attempts: 2 });
        const prior = JSON.stringify(result);
        if (lateKind === 'confirmed') read.resolve(RECORD);
        else read.reject({ status: 400, message: 'late failure' });
        await vi.advanceTimersByTimeAsync(100);
        await done;
        expect(JSON.stringify(result)).toBe(prior);
        expect(call).toHaveBeenCalledTimes(2);
        expect(server.write).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      } finally { controller.abort(); await done; }
    });
  }

  it('enforces the elapsed deadline when a synchronous lookup throws after it', async () => {
    const call = vi.fn(() => {
      vi.setSystemTime(8);
      throw { status: 400, message: 'expired synchronous lookup' };
    });
    install(call);
    expect(await pollTransaction(HASH, { timeout: 7 }))
      .toMatchObject({ status: 'timeout', state: 'unknown', attempts: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  for (const lateKind of ['confirmed', 'nonretryable rejection'] as const) {
    it('checks the deadline on a late ' + lateKind + ' before the timer callback runs', async () => {
      const read = deferred<typeof RECORD>();
      const call = vi.fn(() => read.promise);
      const server = install(call);
      const done = pollTransaction(HASH, { timeout: 7 });
      vi.setSystemTime(8);
      if (lateKind === 'confirmed') read.resolve(RECORD);
      else read.reject({ status: 400, message: 'expired asynchronous failure' });
      expect(await done).toMatchObject({ status: 'timeout', state: 'unknown', attempts: 1 });
      expect(call).toHaveBeenCalledTimes(1);
      expect(server.write).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it('uses exactly a fractional attempt budget after rounding down', async () => {
    const call = vi.fn().mockRejectedValue({ status: 404 });
    const server = install(call);
    const done = pollTransaction(HASH, { interval: 3, timeout: 100, maxAttempts: 2.9 });
    await vi.advanceTimersByTimeAsync(3);
    expect(await done).toMatchObject({ status: 'timeout', state: 'pending', attempts: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(call).toHaveBeenCalledTimes(2);
    expect(server.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never overlaps delayed reads or starts a new read past its deadline', async () => {
    let active = 0, peak = 0;
    const starts: number[] = [];
    const call = vi.fn(() => {
      starts.push(Date.now());
      active += 1; peak = Math.max(peak, active);
      return new Promise((_resolve, reject) => setTimeout(() => {
        active -= 1; reject({ status: 404 });
      }, 10));
    });
    const server = install(call);
    const done = pollTransaction(HASH, { interval: 2, timeout: 35, maxAttempts: 20 });
    await vi.advanceTimersByTimeAsync(35);
    expect(await done).toMatchObject({ status: 'timeout', state: 'pending', attempts: 3 });
    expect(starts).toEqual([0, 12, 24]);
    expect(peak).toBe(1);
    expect(active).toBe(0);
    expect(server.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps preexisting pre-abort behavior without issuing a read', async () => {
    const controller = new AbortController(); controller.abort();
    const call = vi.fn();
    const server = install(call);
    await expect(pollTransaction(HASH, { timeout: 7, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(call).not.toHaveBeenCalled();
    expect(server.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps in-flight abort behavior while handling a later transport rejection', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const read = deferred<typeof RECORD>();
    const call = vi.fn(() => read.promise);
    const server = install(call);
    const done = pollTransaction(HASH, { timeout: 7, signal: controller.signal })
      .then(() => undefined, (error: any) => error);
    controller.abort();
    expect(await done).toMatchObject({ name: 'AbortError' });
    read.reject(new Error('late aborted rejection'));
    await vi.advanceTimersByTimeAsync(100);
    expect(call).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
    expect(server.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a valid timeout beyond the host timer range for a prompt read', async () => {
    vi.useRealTimers();
    const call = vi.fn(() => new Promise<typeof RECORD>(resolve => {
      setTimeout(() => resolve(RECORD), 12);
    }));
    const server = install(call);
    expect(await pollTransaction(HASH, { timeout: 2_147_483_648 }))
      .toMatchObject({ status: 'success', state: 'confirmed', attempts: 1 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(server.write).not.toHaveBeenCalled();
  });

  it('respects a long retry interval across the host timer range', async () => {
    const interval = 2_147_483_650;
    const controller = new AbortController();
    const call = vi.fn().mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce(RECORD);
    const server = install(call);
    const done = pollTransaction(HASH, {
      interval, timeout: interval * 2, maxAttempts: 2, signal: controller.signal,
    }).then((result: any) => result, () => undefined);
    try {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_147_483_647);
      expect(call).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3);
      expect(await done).toMatchObject({ status: 'success', state: 'confirmed', attempts: 2 });
      expect(call).toHaveBeenCalledTimes(2);
      expect(server.write).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { controller.abort(); await done; }
  });

  it('keeps prompt ledger failure distinct from lookup timeout and releases resources', async () => {
    const controller = new AbortController();
    const call = vi.fn().mockResolvedValue({ ...RECORD, successful: false });
    const server = install(call);
    expect(await pollTransaction(HASH, { timeout: 7, signal: controller.signal }))
      .toMatchObject({ status: 'failure', state: 'failed', attempts: 1 });
    expect(server.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
