const crypto = require('crypto');
const { json, requireEnvironment, supabaseRequest } = require('../_lib/supabase');
const { CentralPhoneBlockUnavailableError, checkPhoneBlock, normalizeTaiwanPhone } = require('../_lib/central-phone-block');

const allowedAmounts = new Set(['10萬-30萬', '30萬-80萬', '80萬-180萬', '180萬-300萬']);

const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
const hashIp = (ip) => crypto.createHmac('sha256', requireEnvironment('LEAD_HASH_SALT')).update(ip || 'unknown').digest('hex');
const duplicateWindowMs = 24 * 60 * 60 * 1000;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const payload = bodyOf(req);
    const name = String(payload.name || '').trim();
    const age = Number(payload.age);
    const phone = normalizeTaiwanPhone(payload.phone);
    const requestedAmount = String(payload.amount || '');
    const warningAccount = payload.warningAccount === true;
    if (!name || name.length > 80 || !Number.isInteger(age) || age < 18 || age > 120 || !phone || !allowedAmounts.has(requestedAmount) || typeof payload.warningAccount !== 'boolean') {
      return json(res, 400, { error: '請確認表單資料後重新送出。' });
    }
    if (warningAccount) return json(res, 422, { error: '警示戶目前無法提供本項資金媒合服務。' });

    // This check runs before every local block, duplicate, and insert path.
    // Any central timeout or malformed reply fails closed without creating a lead.
    const centralBlockState = await checkPhoneBlock(phone);
    if (centralBlockState.blocked) {
      return json(res, 403, { error: '此手機號碼目前無法再次提交申請，請等待專員聯繫。' });
    }

    const submissionBlocks = await supabaseRequest(`/rest/v1/submission_blocks?select=id&phone=eq.${encodeURIComponent(phone)}&limit=1`);
    if (submissionBlocks?.length) {
      return json(res, 403, { error: '此手機號碼目前無法再次提交申請，請等待專員聯繫。' });
    }

    const duplicateCutoff = new Date(Date.now() - duplicateWindowMs).toISOString();
    const recentLeads = await supabaseRequest(`/rest/v1/leads?select=id&phone=eq.${encodeURIComponent(phone)}&created_at=gte.${encodeURIComponent(duplicateCutoff)}&limit=1`);
    if (recentLeads?.length) {
      return json(res, 409, { error: '此手機號碼已送出申請，請直接加入 LINE 等待專員聯繫。' });
    }

    const browserEventId = crypto.randomUUID();
    const lead = {
      name,
      age,
      phone,
      requested_amount: requestedAmount,
      warning_account: warningAccount,
      status: 'new',
      status_updated_at: new Date().toISOString(),
      line_redirected_at: null,
      consent_at: new Date().toISOString(),
      tiktok_click_id: String(payload.tiktokClickId || '').slice(0, 512) || null,
      browser_event_id: browserEventId,
      // A per-submission salt keeps the legacy unique column compatible
      // while allowing multiple applications from the same network.
      client_ip_hash: hashIp(`${clientIp(req)}:${browserEventId}`),
      source_url: String(payload.sourceUrl || '').slice(0, 2048) || null,
      metadata: {
        meta_fbp: String(payload.metaFbp || '').slice(0, 256) || null,
        meta_fbc: String(payload.metaFbc || '').slice(0, 256) || null,
        client_user_agent: String(req.headers['user-agent'] || '').slice(0, 1024) || null,
      },
    };
    const inserted = await supabaseRequest('/rest/v1/leads', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(lead),
    });
    const created = inserted?.[0];
    if (!created?.id) throw new Error('Lead insert returned no identifier.');

    try {
      await supabaseRequest('/rest/v1/lead_status_events', {
        method: 'POST',
        body: JSON.stringify({ lead_id: created.id, next_status: 'new', notes: '客戶已由表單送出，待確認 LINE 到達。', tiktok_delivery_status: 'skipped' }),
      });
    } catch (error) {
      console.error('Lead status event recording failed:', {
        leadId: created.id,
        status: error.status || null,
        details: error.details || null,
        message: error.message,
      });
    }

    return json(res, 201, { leadId: created.id, browserEventId });
  } catch (error) {
    if (error instanceof CentralPhoneBlockUnavailableError || error?.code === 'central_phone_block_unavailable') {
      return json(res, 503, { error: '系統暫時無法驗證申請資格，請稍後再試。' });
    }
    console.error('Lead creation failed:', error.message);
    return json(res, 500, { error: '系統暫時無法送出，請稍後再試。' });
  }
};
