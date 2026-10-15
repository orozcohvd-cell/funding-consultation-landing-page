'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  CentralPhoneBlockUnavailableError,
  checkPhoneBlock,
  normalizeLegacyStoredPhone,
  normalizeTaiwanPhone,
  phoneHmac,
  revokePhoneBlock,
  signCentralRequest,
} = require('../api/_lib/central-phone-block');

test('normalizes every accepted Taiwan mobile format to 09xxxxxxxx', () => {
  assert.equal(normalizeTaiwanPhone('0912345678'), '0912345678');
  assert.equal(normalizeTaiwanPhone('+8860912345678'), '0912345678');
  assert.equal(normalizeTaiwanPhone('8860912345678'), '0912345678');
});

test('rejects phone formats outside the accepted Taiwan mobile patterns', () => {
  assert.equal(normalizeTaiwanPhone('091234567'), null);
  assert.equal(normalizeTaiwanPhone('09123456789'), null);
  assert.equal(normalizeTaiwanPhone('+886912345678'), null);
  assert.equal(normalizeTaiwanPhone('09 12345678'), null);
});

test('repairs only the historic server-side 009xxxxxxxx storage defect', () => {
  assert.equal(normalizeTaiwanPhone('00912345678'), null);
  assert.equal(normalizeLegacyStoredPhone('00912345678'), '0912345678');
  assert.equal(normalizeLegacyStoredPhone('00812345678'), null);
});

test('builds the prefixed phone HMAC without exposing the phone in the body', () => {
  const canonical = '0912345678';
  const secret = 'test-hmac-secret';
  const expected = crypto.createHmac('sha256', secret).update(`central-phone-block:v1:${canonical}`).digest('hex');
  const value = phoneHmac('+8860912345678', { hmacSecret: secret });
  assert.equal(value, expected);
  assert.match(value, /^[0-9a-f]{64}$/);
});

test('treats an unavailable HMAC secret as a fail-closed service error', () => {
  const previous = process.env.CENTRAL_PHONE_BLOCK_HMAC_SECRET;
  delete process.env.CENTRAL_PHONE_BLOCK_HMAC_SECRET;
  try {
    assert.throws(() => phoneHmac('0912345678'), CentralPhoneBlockUnavailableError);
  } finally {
    if (previous === undefined) delete process.env.CENTRAL_PHONE_BLOCK_HMAC_SECRET;
    else process.env.CENTRAL_PHONE_BLOCK_HMAC_SECRET = previous;
  }
});

test('sends only a phone HMAC to the central check endpoint', async () => {
  const phone = '+8860912345678';
  const expectedPhoneHmac = phoneHmac(phone, { hmacSecret: 'test-hmac-secret' });
  let captured;
  const result = await checkPhoneBlock(phone, {
    url: 'https://central.example/functions/v1/phone-block',
    hmacSecret: 'test-hmac-secret',
    callerSecret: 'test-caller-secret',
    timestamp: '1700000000000',
    nonce: 'c'.repeat(64),
    fetchImpl: async (_url, request) => {
      captured = request;
      return { ok: true, json: async () => ({ available: true, blocked: false }) };
    },
  });

  assert.deepEqual(result, { available: true, blocked: false });
  assert.deepEqual(JSON.parse(captured.body), { op: 'check', phoneHmac: expectedPhoneHmac });
  assert.equal(captured.body.includes('0912345678'), false);
});

test('signs the exact versioned central request payload', () => {
  const body = {
    op: 'assert',
    phoneHmac: 'b'.repeat(64),
    sourceRuleId: 'submission-block:123e4567-e89b-42d3-a456-426614174000',
  };
  const callerSecret = 'test-caller-secret';
  const timestamp = '1700000000000';
  const nonce = 'a'.repeat(64);
  const signed = signCentralRequest(body, { callerSecret, timestamp, nonce });

  const serializedBody = JSON.stringify(body);
  const payloadHash = crypto.createHash('sha256').update(serializedBody).digest('hex');
  const expectedMessage = `v1\nfunding-consultation\n${timestamp}\n${nonce}\n${payloadHash}`;
  const expectedSignature = crypto.createHmac('sha256', callerSecret).update(expectedMessage).digest('hex');

  assert.equal(signed.serializedBody, serializedBody);
  assert.equal(signed.headers['x-central-block-caller'], 'funding-consultation');
  assert.equal(signed.headers['x-central-block-timestamp'], timestamp);
  assert.equal(signed.headers['x-central-block-nonce'], nonce);
  assert.equal(signed.headers['x-central-block-signature'], expectedSignature);
  assert.equal(signed.serializedBody.includes('0912345678'), false);
});

test('a legacy revoke succeeds when the current site still blocks the phone', async () => {
  const state = await revokePhoneBlock(
    '0912345678',
    'submission-block:123e4567-e89b-42d3-a456-426614174000',
    {
      url: 'https://central.example/functions/v1/phone-block',
      hmacSecret: 'test-hmac-secret',
      callerSecret: 'test-caller-secret',
      timestamp: '1700000000000',
      nonce: 'd'.repeat(64),
      fetchImpl: async () => ({ ok: true, json: async () => ({ blocked: true }) }),
    },
  );

  assert.deepEqual(state, { available: false, blocked: true });
});
