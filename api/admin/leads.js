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
    const warningAccount = typeof req.query.warningAccount === 'string' ? req.query.warningAccount : 'all';
    const range = selectedDate ? dateRangeForTaiwan(selectedDate) : null;
    if (selectedDate && !range) return json(res, 400, { error: '日期格式不正確。' });
    if (!['all', 'yes', 'no'].includes(warningAccount)) return json(res, 400, { error: '警示戶篩選格式不正確。' });

    const baseQuery = new URLSearchParams({ select: '*', order: 'created_at.desc' });
    if (range) {
      baseQuery.append('created_at', `gte.${range.start}`);
      baseQuery.append('created_at', `lt.${range.end}`);
    }
    const statsQuery = baseQuery.toString();
    const leadQuery = new URLSearchParams(baseQuery);
    if (warningAccount === 'yes') leadQuery.append('warning_account', 'eq.true');
    if (warningAccount === 'no') leadQuery.append('warning_account', 'eq.false');
    const [allLeads, leads] = await Promise.all([
      supabaseRequest(`/rest/v1/leads?${statsQuery}`),
      warningAccount === 'all' ? Promise.resolve(null) : supabaseRequest(`/rest/v1/leads?${leadQuery.toString()}`),
    ]);
    const displayedLeads = leads || allLeads;
    json(res, 200, {
      leads: displayedLeads,
      stats: {
        selectedDate: selectedDate || null,
        submissionCount: allLeads.length,
        warningYesCount: allLeads.filter((lead) => lead.warning_account === true).length,
        warningNoCount: allLeads.filter((lead) => lead.warning_account !== true).length,
      },
    });
  } catch (error) {
    json(res, error.status || 500, { error: error.message || 'Unable to load leads.' });
  }
};
