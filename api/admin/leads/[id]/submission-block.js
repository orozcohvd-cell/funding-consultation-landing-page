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
      const sourceRuleId = `submission-block:${existingBlock.id}`;
      const centralState = await revokePhoneBlock(canonicalPhone, sourceRuleId);
      try {
        await supabaseRequest(`/rest/v1/submission_blocks?id=eq.${encodeURIComponent(existingBlock.id)}`, { method: 'DELETE' });
      } catch {
        // The delete may have committed even if its response was lost. Restore
        // the central assertion only after confirming the local rule remains.
        let localRows;
        try {
          localRows = await supabaseRequest(`/rest/v1/submission_blocks?id=eq.${encodeURIComponent(existingBlock.id)}&select=id&limit=1`);
        } catch {
          console.error('Submission block delete outcome cannot be verified after central revoke.');
          return json(res, 503, {
            code: 'block_state_requires_reconciliation',
            error: '中央封鎖已解除，但本網站刪除狀態尚待確認，請通知管理員處理。',
          });
        }

        if (!Array.isArray(localRows) || localRows.some((row) => row.id !== existingBlock.id)) {
          console.error('Submission block delete verification returned an unexpected result.');
          return json(res, 503, {
            code: 'block_state_requires_reconciliation',
            error: '中央封鎖已解除，但本網站刪除狀態尚待確認，請通知管理員處理。',
          });
        }
        if (!localRows.length) {
          return json(res, 200, { blocked: false, effectiveBlocked: centralState.blocked, recovered: true });
        }

        try {
          await assertPhoneBlock(canonicalPhone, sourceRuleId);
        } catch {
          console.error('Central submission block restoration failed.');
          return json(res, 503, {
            code: 'block_state_requires_reconciliation',
            error: '本網站封鎖仍生效，但中央封鎖需管理員核對。',
          });
        }
        return json(res, 503, {
          code: 'local_block_delete_failed',
          error: '本網站封鎖仍生效，中央狀態已回復，請重試。',
        });
      }
      return json(res, 200, { blocked: false, effectiveBlocked: centralState.blocked });
    }

    const { reason = '' } = bodyOf(req);
    const blockId = existingBlock?.id || crypto.randomUUID();
    // Assert the shared rule before mutating the legacy local cache. The source
    // ID remains stable for later edits and idempotent backfill retries.
    await assertPhoneBlock(canonicalPhone, `submission-block:${blockId}`);
    let blocked;
    try {
      blocked = await supabaseRequest('/rest/v1/submission_blocks?on_conflict=phone', {
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
    } catch {
      // A central assert can succeed even if the local POST response is lost.
      // Never revoke an existing rule, and verify a new rule's write outcome
      // before attempting compensation.
      if (existingBlock) {
        return json(res, 503, {
          code: 'local_block_update_failed',
          error: '既有封鎖仍生效，但本網站更新未完成，請稍後重試。',
        });
      }

      let localRows;
      try {
        localRows = await supabaseRequest(`/rest/v1/submission_blocks?id=eq.${encodeURIComponent(blockId)}&select=id&limit=1`);
      } catch {
        console.error('Submission block write outcome cannot be verified after central assertion.');
        return json(res, 503, {
          code: 'block_state_requires_reconciliation',
          error: '中央封鎖已建立，但本網站寫入狀態尚待確認，請通知管理員處理。',
        });
      }

      if (!Array.isArray(localRows) || localRows.some((row) => row.id !== blockId)) {
        console.error('Submission block verification returned an unexpected result.');
        return json(res, 503, {
          code: 'block_state_requires_reconciliation',
          error: '中央封鎖已建立，但本網站寫入狀態尚待確認，請通知管理員處理。',
        });
      }
      if (localRows.length) return json(res, 200, { blocked: true, recovered: true });

      try {
        await revokePhoneBlock(canonicalPhone, `submission-block:${blockId}`);
      } catch {
        console.error('Central submission block compensation failed.');
        return json(res, 503, {
          code: 'block_state_requires_reconciliation',
          error: '本網站封鎖未完成，中央封鎖需管理員核對。',
        });
      }
      return json(res, 503, {
        code: 'local_block_write_failed',
        error: '本網站封鎖未完成，中央狀態已回復，請重試。',
      });
    }
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
