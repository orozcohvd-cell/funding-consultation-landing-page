const crypto = require('crypto');
const { json, requireStaff, supabaseRequest } = require('../../../_lib/supabase');
const {
  CentralPhoneBlockInputError,
  CentralPhoneBlockUnavailableError,
  assertPhoneBlock,
  normalizeLegacyStoredPhone,
  revokePhoneBlock,
} = require('../../../_lib/central-phone-block');

const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

module.exports = async (req, res) => {
  if (!['POST', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
  try {
    const { user } = await requireStaff(req);
    const leadId = String(req.query.id || '');
    const current = await supabaseRequest(`/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=id,phone`);
    const lead = current?.[0];
    if (!lead) return json(res, 404, { error: 'Lead not found.' });

    const canonicalPhone = normalizeLegacyStoredPhone(lead.phone);
    if (!canonicalPhone) return json(res, 422, { error: '此手機號碼格式無法同步中央封鎖，未變更本機封鎖。' });
    const existing = await supabaseRequest(`/rest/v1/submission_blocks?phone=eq.${encodeURIComponent(lead.phone)}&select=id&limit=1`);
    const existingBlock = existing?.[0] || null;

    if (req.method === 'DELETE') {
      if (!existingBlock?.id) return json(res, 200, { blocked: false, alreadyCleared: true });
      // The central rule is authoritative. If the following local delete fails,
      // the legacy local block remains as the conservative fallback.
      const centralState = await revokePhoneBlock(canonicalPhone, `submission-block:${existingBlock.id}`);
      await supabaseRequest(`/rest/v1/submission_blocks?id=eq.${encodeURIComponent(existingBlock.id)}`, { method: 'DELETE' });
      return json(res, 200, { blocked: false, effectiveBlocked: centralState.blocked });
    }

    const { reason = '' } = bodyOf(req);
    const blockId = existingBlock?.id || crypto.randomUUID();
    // Assert the shared rule before mutating the legacy local cache. The source
    // ID remains stable for later edits and idempotent backfill retries.
    await assertPhoneBlock(canonicalPhone, `submission-block:${blockId}`);
    const blocked = await supabaseRequest('/rest/v1/submission_blocks?on_conflict=phone', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        id: blockId,
        phone: lead.phone,
        reason: String(reason).trim().slice(0, 300) || '專員手動屏蔽',
        source_lead_id: lead.id,
        blocked_by: user.id,
        updated_at: new Date().toISOString(),
      }),
    });
    return json(res, 200, { blocked: true, block: blocked?.[0] || null });
  } catch (error) {
    if (error instanceof CentralPhoneBlockUnavailableError || error?.code === 'central_phone_block_unavailable') {
      return json(res, 503, { error: '中央封鎖服務暫時無法使用，未變更本機封鎖。' });
    }
    if (error instanceof CentralPhoneBlockInputError || error?.code === 'central_phone_block_invalid_input') {
      return json(res, 422, { error: '此手機號碼格式無法同步中央封鎖，未變更本機封鎖。' });
    }
    console.error('Submission block update failed:', error.message);
    return json(res, error.status || 500, { error: error.message || 'Unable to update submission block.' });
  }
};
