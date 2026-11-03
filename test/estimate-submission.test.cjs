'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const supabasePath = require.resolve('../api/_lib/supabase');
const centralPath = require.resolve('../api/_lib/central-phone-block');
const handlerPath = require.resolve('../api/leads');

function loadHandler(supabaseRequest) {
  const originalSupabase = require(supabasePath);
  const originalCentral = require(centralPath);
  require.cache[supabasePath].exports = {
    ...originalSupabase,
    requireEnvironment: () => 'test-only-salt',
    supabaseRequest,
  };
  require.cache[centralPath].exports = {
    ...originalCentral,
    checkPhoneBlock: async () => ({ blocked: false }),
    normalizeTaiwanPhone: value => value,
  };
  delete require.cache[handlerPath];
  try {
    return require(handlerPath);
  } finally {
    require.cache[supabasePath].exports = originalSupabase;
    require.cache[centralPath].exports = originalCentral;
    delete require.cache[handlerPath];
  }
}

function response() {
  return {
    status(value) { this.statusCode = value; return this; },
    setHeader() { return this; },
    send(value) { this.body = JSON.parse(value); return this; },
  };
}

const base = {
  name: '測試用戶', age: 35, phone: '0912345678', warningAccount: false,
};

test('exact calculator amount keeps the existing database range and records estimate details', async () => {
  let inserted;
  const handler = loadHandler(async (path, options = {}) => {
    if (path.startsWith('/rest/v1/submission_blocks?')) return [];
    if (path.startsWith('/rest/v1/leads?')) return [];
    if (path === '/rest/v1/leads' && options.method === 'POST') {
      inserted = JSON.parse(options.body);
      return [{ id: '123e4567-e89b-42d3-a456-426614174002' }];
    }
    if (path === '/rest/v1/lead_status_events') return null;
    throw new Error(`unexpected request: ${path}`);
  });
  const res = response();
  await handler({ method: 'POST', headers: {}, body: { ...base, amount: '300000', months: 36, assumedAnnualRate: 2 } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(inserted.requested_amount, '30萬-80萬');
  assert.deepEqual(inserted.metadata.estimate, { amount: 300000, months: 36, assumed_annual_rate: 2 });
});

test('warning accounts are rejected before any database request', async () => {
  const handler = loadHandler(async () => { throw new Error('database should not be called'); });
  const res = response();
  await handler({ method: 'POST', headers: {}, body: { ...base, amount: '300000', months: 36, assumedAnnualRate: 2, warningAccount: true } }, res);
  assert.equal(res.statusCode, 422);
});
