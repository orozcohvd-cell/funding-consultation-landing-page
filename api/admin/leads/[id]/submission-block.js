const { json, requireStaff, supabaseRequest } = require('../../../_lib/supabase');

const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

module.exports = async (req, res) => {
  if (!['POST', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
  try {
    const { user } = await requireStaff(req);
    const leadId = String(req.query.id || '');
    const current = await supabaseRequest(`/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=id,phone`);
    const lead = current?.[0];
    if (!lead) return json(res, 404, { error: 'Lead not found.' });

    if (req.method === 'DELETE') {
      await supabaseRequest(`/rest/v1/submission_blocks?phone=eq.${encodeURIComponent(lead.phone)}`, { method: 'DELETE' });
      return json(res, 200, { blocked: false });
    }

    const { reason = '' } = bodyOf(req);
    const blocked = await supabaseRequest('/rest/v1/submission_blocks?on_conflict=phone', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        phone: lead.phone,
        reason: String(reason).trim().slice(0, 300) || '專員手動屏蔽',
        source_lead_id: lead.id,
        blocked_by: user.id,
        updated_at: new Date().toISOString(),
      }),
    });
    return json(res, 200, { blocked: true, block: blocked?.[0] || null });
  } catch (error) {
    console.error('Submission block update failed:', error.message);
    return json(res, error.status || 500, { error: error.message || 'Unable to update submission block.' });
  }
};
