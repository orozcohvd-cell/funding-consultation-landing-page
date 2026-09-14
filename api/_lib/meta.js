const crypto = require('crypto');

const statusEventMap = {
  contacted: 'Contact',
  qualified: 'Lead',
};

async function sendMetaStatusEvent({ lead, status }) {
  const event = statusEventMap[status];
  if (!event) return { deliveryStatus: 'skipped', eventName: null, eventId: null, response: { reason: 'No Meta event mapped for this status.' } };

  const token = process.env.META_CAPI_ACCESS_TOKEN;
  const pixelId = process.env.META_PIXEL_ID;
  if (!token || !pixelId) {
    return { deliveryStatus: 'skipped', eventName: event, eventId: null, response: { reason: 'Meta Conversions API is not configured.' } };
  }

  const eventId = crypto.randomUUID();
  const metadata = lead.metadata && typeof lead.metadata === 'object' ? lead.metadata : {};
  const userData = {};
  if (metadata.meta_fbp) userData.fbp = metadata.meta_fbp;
  if (metadata.meta_fbc) userData.fbc = metadata.meta_fbc;
  if (metadata.client_ip_address) userData.client_ip_address = metadata.client_ip_address;
  if (metadata.client_user_agent) userData.client_user_agent = metadata.client_user_agent;

  const payload = {
    data: [{
      event_name: event,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: process.env.SITE_URL || lead.source_url || '',
      user_data: userData,
    }],
  };

  try {
    const graphVersion = process.env.META_GRAPH_API_VERSION || 'v23.0';
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : {}; } catch { result = { raw: text }; }
    const accepted = response.ok && Number(result.events_received) > 0;
    return { deliveryStatus: accepted ? 'sent' : 'failed', eventName: event, eventId, response: result };
  } catch (error) {
    return { deliveryStatus: 'failed', eventName: event, eventId, response: { message: error.message } };
  }
}

module.exports = { sendMetaStatusEvent };
