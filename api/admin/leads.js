const { json, requireStaff, supabaseRequest } = require('../_lib/supabase');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  try {
    await requireStaff(req);
    const leads = await supabaseRequest('/rest/v1/leads?select=*&order=created_at.desc');
    json(res, 200, { leads });
  } catch (error) {
    json(res, error.status || 500, { error: error.message || 'Unable to load leads.' });
  }
};
