let supabaseClient;
let currentSession;

const loginView = document.querySelector('#login-view');
const crmView = document.querySelector('#crm-view');
const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const crmMessage = document.querySelector('#crm-message');
const leadList = document.querySelector('#lead-list');

const statusLabels = { new: '新線索', line_redirected: '已前往 LINE', contacted: '已聯絡', qualified: '有效諮詢', won: '成交', lost: '無效' };
const statusActions = [['contacted', '標記已聯絡'], ['qualified', '標記有效諮詢'], ['won', '標記成交'], ['lost', '標記無效']];

const setMessage = (target, text = '') => { target.textContent = text; };
const formatTime = (value) => new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

async function api(path, options = {}) {
  const session = currentSession || (await supabaseClient.auth.getSession()).data.session;
  if (!session) throw new Error('登入狀態已失效，請重新登入。');
  const response = await fetch(path, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '系統暫時無法處理。');
  return data;
}

function leadCard(lead) {
  const card = document.createElement('article');
  card.className = 'lead-card';
  const details = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = lead.name;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = statusLabels[lead.status] || lead.status;
  const meta = document.createElement('div');
  meta.className = 'lead-meta';
  [
    `電話：${lead.phone}`,
    `年齡：${lead.age}`,
    `額度：${lead.requested_amount}`,
    `警示戶：${lead.warning_account ? '是' : '否'}`,
    `提交：${formatTime(lead.created_at)}`,
  ].forEach((text) => { const item = document.createElement('span'); item.textContent = text; meta.append(item); });
  details.append(title, document.createTextNode(' '), badge, meta);

  const controls = document.createElement('div');
  const notes = document.createElement('textarea');
  notes.className = 'notes';
  notes.placeholder = '專員備註（選填）';
  notes.value = lead.staff_notes || '';
  const actions = document.createElement('div');
  actions.className = 'status-actions';
  statusActions.forEach(([status, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = lead.status === status;
    button.addEventListener('click', async () => {
      setMessage(crmMessage, '正在更新狀態…');
      try {
        await api(`/api/admin/leads/${encodeURIComponent(lead.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status, notes: notes.value }) });
        await loadLeads();
        setMessage(crmMessage, '狀態已更新，TikTok 回傳結果已記錄。');
      } catch (error) { setMessage(crmMessage, error.message); }
    });
    actions.append(button);
  });
  controls.append(notes, actions);
  card.append(details, controls);
  return card;
}

async function loadLeads() {
  setMessage(crmMessage, '正在載入線索…');
  try {
    const { leads } = await api('/api/admin/leads');
    leadList.replaceChildren();
    if (!leads.length) leadList.textContent = '目前尚無線索。';
    else leads.forEach((lead) => leadList.append(leadCard(lead)));
    setMessage(crmMessage);
  } catch (error) { setMessage(crmMessage, error.message); }
}

async function showCrm(session) {
  currentSession = session;
  loginView.hidden = true;
  crmView.hidden = false;
  await loadLeads();
}

async function bootstrap() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (!response.ok) throw new Error(config.error);
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();
    if (data.session) await showCrm(data.session);
  } catch (error) { setMessage(loginMessage, error.message || 'CRM 初始化失敗。'); }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(loginMessage, '正在登入…');
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email: document.querySelector('#email').value, password: document.querySelector('#password').value });
  if (error) return setMessage(loginMessage, '登入失敗，請確認帳號與密碼。');
  await showCrm(data.session);
});

document.querySelector('#refresh-button').addEventListener('click', loadLeads);
document.querySelector('#signout-button').addEventListener('click', async () => { await supabaseClient.auth.signOut(); currentSession = null; crmView.hidden = true; loginView.hidden = false; });
document.querySelector('#reset-password-button').addEventListener('click', async () => {
  const email = document.querySelector('#email').value.trim();
  if (!email) return setMessage(loginMessage, '請先輸入登入電子郵件。');
  // This stable Vercel root is already in Supabase Auth's allowed redirect list.
  // Its recovery shim then opens the dedicated password page.
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: 'https://funding-consultation-landing-page-kinkman1.vercel.app/' });
  setMessage(loginMessage, error ? `無法寄送重設密碼信件：${error.message || '請稍後再試。'}` : '重設密碼信件已寄出，請到信箱開啟。');
});

bootstrap();
