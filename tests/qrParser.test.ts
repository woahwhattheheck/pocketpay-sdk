import { parseQRPayload } from '../src/payments/qrParser';
import { PaymentParseError } from '../src/errors/payment-errors';

describe('QR Parser', () => {
  test('parses valid QR payload', () => {
    const url = 'pocketpay://pay?address=GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H&amount=10.5&asset=USD:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5&memo=hello&metadata=key1%3Avalue1%2Ckey2%3Avalue2';
    const result = parseQRPayload(url);
    expect(result.address).toBe('GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H');
    expect(result.amount).toBe('10.5');
    expect(result.asset).toEqual({ code: 'USD', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' });
    expect(result.memo).toBe('hello');
    expect(result.metadata).toEqual({ key1: 'value1', key2: 'value2' });
  });

  test('throws on malformed URL', () => {
    const badUrl = 'pocketpay://pay?address=invalid&amount=abc';
    expect(() => parseQRPayload(badUrl)).toThrow(PaymentParseError);
  });
});
