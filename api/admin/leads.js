const { json, requireStaff, supabaseRequest } = require('../_lib/supabase');

const dateRangeForTaiwan = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  try {
    await requireStaff(req);
    const selectedDate = typeof req.query.date === 'string' ? req.query.date : '';
    const range = selectedDate ? dateRangeForTaiwan(selectedDate) : null;
    if (selectedDate && !range) return json(res, 400, { error: '日期格式不正確。' });

    const query = new URLSearchParams({ select: '*', order: 'created_at.desc' });
    if (range) {
      query.append('created_at', `gte.${range.start}`);
      query.append('created_at', `lt.${range.end}`);
    }
    const leads = await supabaseRequest(`/rest/v1/leads?${query.toString()}`);
    json(res, 200, { leads, stats: { selectedDate: selectedDate || null, submissionCount: leads.length } });
  } catch (error) {
    json(res, error.status || 500, { error: error.message || 'Unable to load leads.' });
  }
};
