const requireEnvironment = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const supabaseUrl = () => requireEnvironment('SUPABASE_URL').replace(/\/$/, '');

const firstEnvironment = (...names) => {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
};

const serviceKey = () => firstEnvironment('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const publicKey = () => firstEnvironment('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');

const serviceHeaders = () => ({
  apikey: serviceKey(),
  Authorization: `Bearer ${serviceKey()}`,
  'Content-Type': 'application/json',
});

const publicHeaders = () => ({
  apikey: publicKey(),
  Authorization: `Bearer ${publicKey()}`,
});

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${supabaseUrl()}${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers || {}) },
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error = new Error('Supabase request failed.');
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

async function requireStaff(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    const error = new Error('Authentication required.');
    error.status = 401;
    throw error;
  }

  const userResponse = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { ...publicHeaders(), Authorization: authorization },
  });
  if (!userResponse.ok) {
    const error = new Error('Invalid staff session.');
    error.status = 401;
    throw error;
  }
  const user = await userResponse.json();
  const staff = await supabaseRequest(`/rest/v1/crm_staff?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,display_name,role`);
  if (!staff?.[0]) {
    const error = new Error('This account is not approved for CRM access.');
    error.status = 403;
    throw error;
  }
  return { user, staff: staff[0] };
}

const json = (res, status, body) => {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
};

module.exports = { json, publicKey, requireEnvironment, requireStaff, supabaseRequest };
