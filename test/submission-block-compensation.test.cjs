'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const supabasePath = require.resolve('../api/_lib/supabase');
const centralPath = require.resolve('../api/_lib/central-phone-block');
const handlerPath = require.resolve('../api/admin/leads/[id]/submission-block');

function loadHandler(supabaseRequest, centralOverrides) {
  const originalSupabase = require(supabasePath);
  const originalCentral = require(centralPath);
  require.cache[supabasePath].exports = {
    ...originalSupabase,
    requireStaff: async () => ({ user: { id: '123e4567-e89b-42d3-a456-426614174001' } }),
    supabaseRequest,
  };
  require.cache[centralPath].exports = { ...originalCentral, ...centralOverrides };
  delete require.cache[handlerPath];
  try {
    return require(handlerPath);
  } finally {
    require.cache[supabasePath].exports = originalSupabase;
    require.cache[centralPath].exports = originalCentral;
    delete require.cache[handlerPath];
  }
}

async function runFailedLocalWrite({ existingBlockId = null, readOutcome = 'missing', revokeFails = false }) {
  let assertedRuleId;
  let revokedRuleId;
  let localWriteAttempts = 0;
  const supabaseRequest = async (path, options = {}) => {
    if (path.startsWith('/rest/v1/leads?id=eq.')) {
      return [{ id: '123e4567-e89b-42d3-a456-426614174002', phone: '0912345678' }];
    }
    if (path.startsWith('/rest/v1/submission_blocks?phone=eq.')) {
      return existingBlockId ? [{ id: existingBlockId }] : [];
    }
    if (path === '/rest/v1/submission_blocks?on_conflict=phone' && options.method === 'POST') {
      localWriteAttempts += 1;
      throw new Error('simulated local write failure');
    }
    if (path.startsWith('/rest/v1/submission_blocks?id=eq.')) {
      if (readOutcome === 'unavailable') throw new Error('simulated verification failure');
      const id = new URL(`https://example.test${path}`).searchParams.get('id')?.slice(3);
      return readOutcome === 'committed' ? [{ id }] : [];
    }
    throw new Error('unexpected local query');
  };
  const handler = loadHandler(supabaseRequest, {
    assertPhoneBlock: async (_phone, sourceRuleId) => { assertedRuleId = sourceRuleId; },
    revokePhoneBlock: async (_phone, sourceRuleId) => {
      revokedRuleId = sourceRuleId;
      if (revokeFails) throw new Error('simulated central compensation failure');
      return { blocked: false };
    },
  });
  const response = {
    status(value) { this.statusCode = value; return this; },
    setHeader() { return this; },
    send(value) { this.body = JSON.parse(value); return this; },
  };
  await handler({ method: 'POST', query: { id: '123e4567-e89b-42d3-a456-426614174002' }, headers: {}, body: {} }, response);
  return { response, assertedRuleId, revokedRuleId, localWriteAttempts };
}

async function runFailedLocalDelete({ readOutcome = 'present', restoreFails = false }) {
  const blockId = '123e4567-e89b-42d3-a456-426614174003';
  let revokedRuleId;
  let restoredRuleId;
  let localDeleteAttempts = 0;
  const supabaseRequest = async (path, options = {}) => {
    if (path.startsWith('/rest/v1/leads?id=eq.')) {
      return [{ id: '123e4567-e89b-42d3-a456-426614174002', phone: '0912345678' }];
    }
    if (path.startsWith('/rest/v1/submission_blocks?phone=eq.')) return [{ id: blockId }];
    if (path.startsWith('/rest/v1/submission_blocks?id=eq.') && options.method === 'DELETE') {
      localDeleteAttempts += 1;
      throw new Error('simulated local delete failure');
    }
    if (path.startsWith('/rest/v1/submission_blocks?id=eq.')) {
      if (readOutcome === 'unavailable') throw new Error('simulated verification failure');
      return readOutcome === 'present' ? [{ id: blockId }] : [];
    }
    throw new Error('unexpected local query');
  };
  const handler = loadHandler(supabaseRequest, {
    revokePhoneBlock: async (_phone, sourceRuleId) => {
      revokedRuleId = sourceRuleId;
      return { blocked: false };
    },
    assertPhoneBlock: async (_phone, sourceRuleId) => {
      restoredRuleId = sourceRuleId;
      if (restoreFails) throw new Error('simulated central restoration failure');
      return { blocked: true };
    },
  });
  const response = {
    status(value) { this.statusCode = value; return this; },
    setHeader() { return this; },
    send(value) { this.body = JSON.parse(value); return this; },
  };
  await handler({ method: 'DELETE', query: { id: '123e4567-e89b-42d3-a456-426614174002' }, headers: {} }, response);
  return { response, revokedRuleId, restoredRuleId, localDeleteAttempts, blockId };
}

test('reverses a new central assertion only after confirming the local write is absent', async () => {
  const result = await runFailedLocalWrite({ readOutcome: 'missing' });
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.response.body.code, 'local_block_write_failed');
  assert.match(result.assertedRuleId, /^submission-block:[0-9a-f-]{36}$/);
  assert.equal(result.revokedRuleId, result.assertedRuleId);
  assert.equal(result.localWriteAttempts, 1);
  assert.equal(JSON.stringify(result.response.body).includes('0912345678'), false);
});

test('keeps the central assertion when the local write committed despite a lost response', async () => {
  const result = await runFailedLocalWrite({ readOutcome: 'committed' });
  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.response.body, { blocked: true, recovered: true });
  assert.equal(result.revokedRuleId, undefined);
});

test('fails closed without revocation when the local write outcome cannot be verified', async () => {
  const result = await runFailedLocalWrite({ readOutcome: 'unavailable' });
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.response.body.code, 'block_state_requires_reconciliation');
  assert.equal(result.revokedRuleId, undefined);
});

test('reports manual reconciliation when compensating the central assertion fails', async () => {
  const result = await runFailedLocalWrite({ readOutcome: 'missing', revokeFails: true });
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.response.body.code, 'block_state_requires_reconciliation');
  assert.equal(result.revokedRuleId, result.assertedRuleId);
});

test('never revokes a pre-existing central assertion when updating the local rule fails', async () => {
  const existingBlockId = '123e4567-e89b-42d3-a456-426614174003';
  const result = await runFailedLocalWrite({ existingBlockId });
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.response.body.code, 'local_block_update_failed');
  assert.equal(result.assertedRuleId, `submission-block:${existingBlockId}`);
  assert.equal(result.revokedRuleId, undefined);
});

test('restores the same central assertion only after confirming local deletion failed', async () => {
  const result = await runFailedLocalDelete({ readOutcome: 'present' });
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.response.body.code, 'local_block_delete_failed');
  assert.equal(result.revokedRuleId, `submission-block:${result.blockId}`);
  assert.equal(result.restoredRuleId, result.revokedRuleId);
  assert.equal(result.localDeleteAttempts, 1);
  assert.equal(JSON.stringify(result.response.body).includes('0912345678'), false);
});

test('accepts a committed local delete despite a lost response without reasserting', async () => {
  const result = await runFailedLocalDelete({ readOutcome: 'missing' });
  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.response.body, { blocked: false, effectiveBlocked: false, recovered: true });
  assert.equal(result.restoredRuleId, undefined);
});

test('requires reconciliation without reassertion when delete outcome is unknown', async () => {
  const result = await runFailedLocalDelete({ readOutcome: 'unavailable' });
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.response.body.code, 'block_state_requires_reconciliation');
  assert.equal(result.restoredRuleId, undefined);
});

test('reports reconciliation when restoring the central assertion fails', async () => {
  const result = await runFailedLocalDelete({ readOutcome: 'present', restoreFails: true });
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.response.body.code, 'block_state_requires_reconciliation');
  assert.equal(result.restoredRuleId, result.revokedRuleId);
});
