const { json, supabaseRequest } = require('../../_lib/supabase');

const validLeadId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const leadId = req.query?.id;
  if (!validLeadId(leadId)) return json(res, 400, { error: 'Invalid lead identifier.' });

  try {
    const now = new Date().toISOString();
    const updated = await supabaseRequest(`/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&status=eq.new`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'line_redirected', status_updated_at: now, line_redirected_at: now }),
    });
    if (!updated?.[0]) return json(res, 200, { ok: true, alreadyRecorded: true });

    try {
      await supabaseRequest('/rest/v1/lead_status_events', {
        method: 'POST',
        body: JSON.stringify({ lead_id: leadId, next_status: 'line_redirected', notes: '客戶已點擊加入 LINE。', tiktok_delivery_status: 'skipped' }),
      });
    } catch (error) {
      console.error('Line click status event recording failed:', { leadId, status: error.status || null, message: error.message });
    }

    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('Line click recording failed:', { leadId, status: error.status || null, message: error.message });
    return json(res, 500, { error: 'Unable to record LINE click.' });
  }
};
