const crypto = require('crypto');

const statusEventMap = {
  contacted: 'Contact',
  qualified: 'SubmitApplication',
  won: 'ApplicationApproval',
};

async function sendTikTokStatusEvent({ lead, status }) {
  const event = statusEventMap[status];
  if (!event) return { deliveryStatus: 'skipped', eventName: null, eventId: null, response: { reason: 'No TikTok event mapped for this status.' } };

  const token = process.env.TIKTOK_EVENTS_API_TOKEN;
  const pixelCode = process.env.TIKTOK_PIXEL_CODE;
  if (!token || !pixelCode) {
    return { deliveryStatus: 'skipped', eventName: event, eventId: null, response: { reason: 'TikTok Events API is not configured.' } };
  }

  const eventId = crypto.randomUUID();
  const user = lead.tiktok_click_id ? { ttclid: lead.tiktok_click_id } : {};
  const payload = {
    pixel_code: pixelCode,
    event,
    event_id: eventId,
    timestamp: Math.floor(Date.now() / 1000),
    context: {
      page: { url: process.env.SITE_URL || '' },
      user,
    },
    properties: { lead_id: lead.id, pipeline_status: status },
  };

  try {
    const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': token },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : {}; } catch { result = { raw: text }; }
    return {
      deliveryStatus: response.ok ? 'sent' : 'failed',
      eventName: event,
      eventId,
      response: result,
    };
  } catch (error) {
    return { deliveryStatus: 'failed', eventName: event, eventId, response: { message: error.message } };
  }
}

module.exports = { sendTikTokStatusEvent };
