const authForm = document.querySelector('#password-form');
const authMessage = document.querySelector('#auth-message');
const setAuthMessage = (text = '') => { authMessage.textContent = text; };
let authClient;

async function initializeAuth() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || '無法初始化帳號驗證。');
    authClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data, error } = await authClient.auth.getSession();
    if (error || !data.session) throw new Error('此連結已失效，請回到 CRM 登入頁重新申請重設密碼。');
    authForm.hidden = false;
    setAuthMessage('請設定至少 8 個字元的新密碼。');
  } catch (error) { setAuthMessage(error.message); }
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.querySelector('#new-password').value;
  const confirmation = document.querySelector('#confirm-password').value;
  if (password !== confirmation) return setAuthMessage('兩次輸入的密碼不一致。');
  setAuthMessage('正在儲存新密碼…');
  const { error } = await authClient.auth.updateUser({ password });
  if (error) return setAuthMessage(error.message || '無法儲存新密碼。');
  setAuthMessage('密碼已設定完成，正在前往 CRM…');
  window.setTimeout(() => window.location.assign('/crm.html'), 900);
});

initializeAuth();
