'use strict';

// Server-only client for the shared phone-block Edge Function. The central
// service receives a keyed HMAC only; raw phone values never leave this app.
const crypto = require('crypto');
const { requireEnvironment } = require('./supabase');

const CENTRAL_PHONE_BLOCK_CALLER = 'funding-consultation';
const CENTRAL_PHONE_BLOCK_TIMEOUT_MS = 4000;
const TAIWAN_MOBILE_PATTERN = /^(?:09\d{8}|(?:\+886|886)09\d{8})$/;
const PHONE_HMAC_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_RULE_ID_PATTERN = /^submission-block:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class CentralPhoneBlockUnavailableError extends Error {
  constructor() {
    super('Central phone-block verification is unavailable.');
    this.name = 'CentralPhoneBlockUnavailableError';
    this.code = 'central_phone_block_unavailable';
    this.status = 503;
  }
}

class CentralPhoneBlockInputError extends Error {
  constructor() {
    super('Phone or source rule identifier is invalid.');
    this.name = 'CentralPhoneBlockInputError';
    this.code = 'central_phone_block_invalid_input';
    this.status = 400;
  }
}

function normalizeTaiwanPhone(value) {
  const input = String(value ?? '').trim();
  if (!TAIWAN_MOBILE_PATTERN.test(input)) return null;

  const digits = input.replace(/\D/g, '');
  // +88609xxxxxxxx and 88609xxxxxxxx both become 09xxxxxxxx.
  return digits.startsWith('886') ? digits.slice(3) : digits;
}

// The former legacy normalizer persisted `009xxxxxxxx` for international
// input. Repair that historical storage defect only in server-side CRM and
// backfill paths; visitor submission validation remains strict above.
function normalizeLegacyStoredPhone(value) {
  const normalized = normalizeTaiwanPhone(value);
  if (normalized) return normalized;
  const stored = String(value ?? '').trim();
  return /^009\d{8}$/.test(stored) ? stored.slice(1) : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function phoneHmac(phone, options = {}) {
  const canonicalPhone = normalizeTaiwanPhone(phone);
  if (!canonicalPhone) throw new CentralPhoneBlockInputError();
  let secret;
  try {
    secret = options.hmacSecret || requireEnvironment('CENTRAL_PHONE_BLOCK_HMAC_SECRET');
  } catch {
    throw new CentralPhoneBlockUnavailableError();
  }
  if (!secret) throw new CentralPhoneBlockUnavailableError();
  return crypto.createHmac('sha256', secret).update(`central-phone-block:v1:${canonicalPhone}`).digest('hex');
}

function signCentralRequest(body, options = {}) {
  const callerSecret = options.callerSecret || requireEnvironment('CENTRAL_PHONE_BLOCK_CALLER_SECRET');
  const timestamp = String(options.timestamp ?? Date.now());
  const nonce = options.nonce || crypto.randomBytes(32).toString('hex');
  if (!callerSecret || !/^\d{13,}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(nonce)) throw new CentralPhoneBlockUnavailableError();

  const serializedBody = JSON.stringify(body);
  const payloadHash = sha256(serializedBody);
  const message = `v1\n${CENTRAL_PHONE_BLOCK_CALLER}\n${timestamp}\n${nonce}\n${payloadHash}`;
  const signature = crypto.createHmac('sha256', callerSecret).update(message).digest('hex');

  return {
    serializedBody,
    headers: {
      'content-type': 'application/json',
      'x-central-block-caller': CENTRAL_PHONE_BLOCK_CALLER,
      'x-central-block-timestamp': timestamp,
      'x-central-block-nonce': nonce,
      'x-central-block-signature': signature,
    },
  };
}

function centralEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('HTTPS is required.');
    return url.toString();
  } catch {
    throw new CentralPhoneBlockUnavailableError();
  }
}

function validSourceRuleId(value) {
  return SOURCE_RULE_ID_PATTERN.test(String(value || ''));
}

function validCentralBody(body) {
  if (!body || typeof body !== 'object' || !['check', 'assert', 'revoke'].includes(body.op) || !PHONE_HMAC_PATTERN.test(body.phoneHmac || '')) return false;
  if (body.op === 'check') return Object.keys(body).length === 2;
  return validSourceRuleId(body.sourceRuleId) && Object.keys(body).length === 3;
}

function responseState(value) {
  if (!value || typeof value !== 'object') return null;
  const { available, blocked } = value;
  if (typeof blocked === 'boolean' && (typeof available === 'undefined' || available === !blocked)) {
    return { available: !blocked, blocked };
  }
  if (typeof available === 'boolean' && typeof blocked === 'undefined') {
    return { available, blocked: !available };
  }
  return null;
}

async function callCentralPhoneBlock(body, options = {}) {
  if (!validCentralBody(body)) throw new CentralPhoneBlockInputError();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new CentralPhoneBlockUnavailableError();

  let endpoint;
  let signedRequest;
  try {
    endpoint = centralEndpoint(options.url || requireEnvironment('CENTRAL_PHONE_BLOCK_URL'));
    signedRequest = signCentralRequest(body, {
      callerSecret: options.callerSecret,
      timestamp: options.timestamp,
      nonce: options.nonce,
    });
  } catch (error) {
    if (error instanceof CentralPhoneBlockUnavailableError) throw error;
    throw new CentralPhoneBlockUnavailableError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CENTRAL_PHONE_BLOCK_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: signedRequest.headers,
      body: signedRequest.serializedBody,
      signal: controller.signal,
    });
    if (!response?.ok) throw new CentralPhoneBlockUnavailableError();

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new CentralPhoneBlockUnavailableError();
    }
    const state = responseState(payload);
    if (!state) throw new CentralPhoneBlockUnavailableError();
    return state;
  } catch (error) {
    if (error instanceof CentralPhoneBlockUnavailableError) throw error;
    throw new CentralPhoneBlockUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

async function checkPhoneBlock(phone, options) {
  return callCentralPhoneBlock({ op: 'check', phoneHmac: phoneHmac(phone, options) }, options);
}

async function assertPhoneBlock(phone, sourceRuleId, options) {
  if (!validSourceRuleId(sourceRuleId)) throw new CentralPhoneBlockInputError();
  const state = await callCentralPhoneBlock({ op: 'assert', phoneHmac: phoneHmac(phone, options), sourceRuleId }, options);
  if (!state.blocked) throw new CentralPhoneBlockUnavailableError();
  return state;
}

async function revokePhoneBlock(phone, sourceRuleId, options) {
  if (!validSourceRuleId(sourceRuleId)) throw new CentralPhoneBlockInputError();
  // Another site's independent assertion can keep the effective state blocked.
  return callCentralPhoneBlock({ op: 'revoke', phoneHmac: phoneHmac(phone, options), sourceRuleId }, options);
}

module.exports = {
  CENTRAL_PHONE_BLOCK_CALLER,
  CENTRAL_PHONE_BLOCK_TIMEOUT_MS,
  CentralPhoneBlockInputError,
  CentralPhoneBlockUnavailableError,
  assertPhoneBlock,
  callCentralPhoneBlock,
  checkPhoneBlock,
  normalizeLegacyStoredPhone,
  normalizeTaiwanPhone,
  phoneHmac,
  revokePhoneBlock,
  signCentralRequest,
};
