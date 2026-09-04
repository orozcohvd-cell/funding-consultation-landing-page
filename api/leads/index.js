const crypto = require('crypto');
const { json, requireEnvironment, supabaseRequest } = require('../_lib/supabase');

const allowedAmounts = new Set(['10萬-30萬', '30萬-80萬', '80萬-180萬', '180萬-300萬']);

const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
const hashIp = (ip) => crypto.createHmac('sha256', requireEnvironment('LEAD_HASH_SALT')).update(ip || 'unknown').digest('hex');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const payload = bodyOf(req);
    const name = String(payload.name || '').trim();
    const age = Number(payload.age);
    const phone = String(payload.phone || '').trim();
    const requestedAmount = String(payload.amount || '');
    const warningAccount = payload.warningAccount === true;
    if (!name || name.length > 80 || !Number.isInteger(age) || age < 18 || age > 120 || phone.length < 6 || phone.length > 32 || !allowedAmounts.has(requestedAmount) || typeof payload.warningAccount !== 'boolean') {
      return json(res, 400, { error: '請確認表單資料後重新送出。' });
    }

    const browserEventId = crypto.randomUUID();
    const lead = {
      name,
      age,
      phone,
      requested_amount: requestedAmount,
      warning_account: warningAccount,
      status: 'line_redirected',
      status_updated_at: new Date().toISOString(),
      line_redirected_at: new Date().toISOString(),
      consent_at: new Date().toISOString(),
      tiktok_click_id: String(payload.tiktokClickId || '').slice(0, 512) || null,
      browser_event_id: browserEventId,
      client_ip_hash: hashIp(clientIp(req)),
      source_url: String(payload.sourceUrl || '').slice(0, 2048) || null,
      metadata: {
        meta_fbp: String(payload.metaFbp || '').slice(0, 256) || null,
        meta_fbc: String(payload.metaFbc || '').slice(0, 256) || null,
        client_ip_address: clientIp(req) || null,
        client_user_agent: String(req.headers['user-agent'] || '').slice(0, 1024) || null,
      },
    };
    const inserted = await supabaseRequest('/rest/v1/leads', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(lead),
    });
    const created = inserted?.[0];
    await supabaseRequest('/rest/v1/lead_status_events', {
      method: 'POST',
      body: JSON.stringify({ lead_id: created.id, next_status: 'line_redirected', notes: '客戶已由表單送出並前往 LINE。', tiktok_delivery_status: 'skipped' }),
    });
    return json(res, 201, { leadId: created.id, browserEventId });
  } catch (error) {
    if (error.status === 409 || error.details?.code === '23505') return json(res, 409, { error: '此網路已提交過申請。' });
    console.error('Lead creation failed:', error.message);
    return json(res, 500, { error: '系統暫時無法送出，請稍後再試。' });
  }
};
