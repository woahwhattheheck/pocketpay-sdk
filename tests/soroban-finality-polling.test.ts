import { describe, expect, it, vi } from 'vitest';
import { pollSorobanTransactionStatus, submitSorobanWithKnownHash } from '../src/soroban/status-polling';

describe('Soroban submitted-transaction finality', () => {
  it('returns confirmed success and failure without polling again', async () => {
    const success = vi.fn().mockResolvedValue({ status: 'SUCCESS', hash: 'abc' });
    const failed = vi.fn().mockResolvedValue({ status: 'FAILED', hash: 'def' });

    await expect(pollSorobanTransactionStatus(success, 30_000)).resolves.toEqual({
      status: 'SUCCESS',
      hash: 'abc',
    });
    await expect(pollSorobanTransactionStatus(failed, 30_000)).resolves.toEqual({
      status: 'FAILED',
      hash: 'def',
    });
    expect(success).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledOnce();
  });

  it('ends repeated NOT_FOUND responses when the overall budget expires', async () => {
    vi.useFakeTimers();
    try {
      const getTransaction = vi.fn().mockResolvedValue({ status: 'NOT_FOUND' });
      const result = pollSorobanTransactionStatus(getTransaction, 2500);

      await vi.advanceTimersByTimeAsync(2500);
      await expect(result).resolves.toBeNull();
      expect(getTransaction).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not convert a broken confirmation lookup into a failed payment', async () => {
    const getTransaction = vi.fn().mockRejectedValue(new Error('temporary RPC failure'));
    await expect(pollSorobanTransactionStatus(getTransaction, 2500))
      .resolves.toBeNull();
    expect(getTransaction).toHaveBeenCalledOnce();
  });

  it('keeps submitted finality unknown when RPC resolves malformed responses', async () => {
    const nullResponse = vi.fn().mockResolvedValue(null);
    await expect(pollSorobanTransactionStatus(nullResponse, 2500))
      .resolves.toBeNull();
    expect(nullResponse).toHaveBeenCalledOnce();

    const throwingStatus = Object.defineProperty({}, 'status', {
      get() { throw new Error('malformed RPC status getter'); },
    });
    const malformed = vi.fn().mockResolvedValue(throwingStatus);
    await expect(pollSorobanTransactionStatus(malformed, 2500))
      .resolves.toBeNull();
    expect(malformed).toHaveBeenCalledOnce();
  });

  it('fails closed for unexpected nonterminal RPC statuses', async () => {
    const getTransaction = vi.fn().mockResolvedValue({ status: 'TRY_AGAIN_LATER' });
    await expect(pollSorobanTransactionStatus(getTransaction, 2500))
      .resolves.toBeNull();
    expect(getTransaction).toHaveBeenCalledOnce();
  });
});

describe('Soroban unknown submission before RPC returns a hash', () => {
  const signedHash = 'a'.repeat(64);

  it('returns the locally signed hash on an ambiguous transport timeout, without resubmission', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Soroban submission timeout'));
    await expect(submitSorobanWithKnownHash(signedHash, send, 2500))
      .resolves.toEqual({ kind: 'unknown', hash: signedHash });
    expect(send).toHaveBeenCalledOnce();
  });

  it('propagates definitive rejection, while retaining ordinary successful responses', async () => {
    const rejected = {
      response: {
        status: 400,
        data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
      },
    };
    const fail = vi.fn().mockRejectedValue(rejected);
    await expect(submitSorobanWithKnownHash(signedHash, fail, 2500))
      .rejects.toBe(rejected);
    expect(fail).toHaveBeenCalledOnce();

    const serverResponse = { status: 'PENDING', hash: 'server-returned-hash' };
    const success = vi.fn().mockResolvedValue(serverResponse);
    await expect(submitSorobanWithKnownHash(signedHash, success, 2500))
      .resolves.toEqual({ kind: 'response', response: serverResponse });
    expect(success).toHaveBeenCalledOnce();
  });
});
