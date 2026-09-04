const { json, requireStaff, supabaseRequest } = require('../../../_lib/supabase');
const { sendTikTokStatusEvent } = require('../../../_lib/tiktok');
const { sendMetaStatusEvent } = require('../../../_lib/meta');

const allowedStatuses = new Set(['contacted', 'qualified', 'won', 'lost']);
const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

module.exports = async (req, res) => {
  if (req.method !== 'PATCH') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const { user } = await requireStaff(req);
    const { status, notes = '' } = bodyOf(req);
    if (!allowedStatuses.has(status)) return json(res, 400, { error: 'Invalid lead status.' });
    const leadId = String(req.query.id || '');
    const current = await supabaseRequest(`/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=*`);
    const lead = current?.[0];
    if (!lead) return json(res, 404, { error: 'Lead not found.' });

    const updated = await supabaseRequest(`/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status, status_updated_at: new Date().toISOString(), assigned_to: user.id, staff_notes: String(notes).slice(0, 4000) || null }),
    });
    const delivery = await sendTikTokStatusEvent({ lead: updated[0], status });
    const metaDelivery = await sendMetaStatusEvent({ lead: updated[0], status });
    await supabaseRequest('/rest/v1/lead_status_events', {
      method: 'POST',
      body: JSON.stringify({
        lead_id: leadId,
        previous_status: lead.status,
        next_status: status,
        changed_by: user.id,
        notes: String(notes).slice(0, 4000) || null,
        tiktok_event_name: delivery.eventName,
        tiktok_event_id: delivery.eventId,
        tiktok_delivery_status: delivery.deliveryStatus,
        tiktok_response: { tiktok: delivery.response, meta: metaDelivery },
      }),
    });
    json(res, 200, { lead: updated[0], tiktok: delivery, meta: metaDelivery });
  } catch (error) {
    console.error('Lead status update failed:', error.message);
    json(res, error.status || 500, { error: error.message || 'Unable to update lead.' });
  }
};
