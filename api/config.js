const { json, publicKey } = require('./_lib/supabase');

module.exports = async (_req, res) => {
  try {
    if (!process.env.SUPABASE_URL) throw new Error('CRM is not configured.');
    json(res, 200, { supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: publicKey() });
  } catch {
    json(res, 503, { error: 'CRM is not configured yet.' });
  }
};
