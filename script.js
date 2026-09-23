const landingPage = document.querySelector('.landing-page');
const applicationPage = document.querySelector('#application-page');
const amountButtons = document.querySelectorAll('[data-amount]');
const continueButton = document.querySelector('#continue-button');
const selectedAmount = document.querySelector('#selected-amount');
const amountField = document.querySelector('#amount-field');
const backButton = document.querySelector('#back-button');
const form = document.querySelector('#lead-form');
const message = document.querySelector('.form-message');
const modal = document.querySelector('#success-modal');
const eligibilityModal = document.querySelector('#eligibility-modal');
const consultationCode = document.querySelector('#consultation-code');
const lineCta = document.querySelector('#line-cta');
const warningAccountField = form.elements['warning-account'];
const warningAccountBlockKey = 'funding-warning-account-blocked';
let selectedFunding = '';
let currentLeadId = '';

const trackTikTokEvent = (eventName, parameters = {}) => {
  if (typeof window.ttq?.track === 'function') {
    window.ttq.track(eventName, parameters);
  }
};

const getTikTokClickId = () => new URLSearchParams(window.location.search).get('ttclid') || '';
const getCookie = (name) => document.cookie.split('; ').find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const leadCode = (leadId) => `L-${String(leadId || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
const isWarningAccountBlocked = () => localStorage.getItem(warningAccountBlockKey) === '1';

const lockApplication = () => {
  selectedFunding = '';
  amountButtons.forEach((button) => {
    button.classList.remove('is-selected');
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
  });
  continueButton.disabled = true;
  continueButton.textContent = '目前無法繼續申請';
};

const recordLineClick = () => {
  if (!currentLeadId) return;
  const body = JSON.stringify({});
  const endpoint = `/api/leads/${encodeURIComponent(currentLeadId)}/line-click`;
  if (navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    return;
  }
  void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
};

const showLandingPage = () => {
  applicationPage.hidden = true;
  landingPage.hidden = false;
  window.scrollTo(0, 0);
};

const showApplicationPage = () => {
  if (isWarningAccountBlocked()) {
    lockApplication();
    showLandingPage();
    return;
  }
  landingPage.hidden = true;
  applicationPage.hidden = false;
  selectedAmount.textContent = selectedFunding;
  amountField.value = selectedFunding;
  window.scrollTo(0, 0);
};

const blockWarningAccountApplication = () => {
  localStorage.setItem(warningAccountBlockKey, '1');
  form.reset();
  message.textContent = '';
  lockApplication();
  showLandingPage();
  eligibilityModal.hidden = false;
  window.setTimeout(() => { eligibilityModal.hidden = true; }, 2600);
};

amountButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (isWarningAccountBlocked()) return;
    selectedFunding = button.dataset.amount;
    amountButtons.forEach((option) => option.classList.toggle('is-selected', option === button));
    continueButton.disabled = false;
  });
});

continueButton.addEventListener('click', () => {
  if (isWarningAccountBlocked()) return;
  trackTikTokEvent('ViewContent');
  showApplicationPage();
});
backButton.addEventListener('click', showLandingPage);

warningAccountField.addEventListener('change', () => {
  if (warningAccountField.value === 'yes') blockWarningAccountApplication();
});

lineCta.addEventListener('click', async (event) => {
  const code = consultationCode.textContent;
  if (!code || code === '—') return;

  event.preventDefault();
  recordLineClick();
  try {
    await navigator.clipboard.writeText(`諮詢編號：${code}`);
  } catch {
    // The on-screen code remains available if the browser blocks clipboard access.
  }
  window.location.assign(lineCta.href);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isWarningAccountBlocked() || warningAccountField.value === 'yes') {
    blockWarningAccountApplication();
    return;
  }
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  message.textContent = '正在送出申請…';
  const data = new FormData(form);
  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.get('name'),
        age: Number(data.get('age')),
        phone: data.get('phone'),
        amount: data.get('amount'),
        warningAccount: data.get('warning-account') === 'yes',
        tiktokClickId: getTikTokClickId(),
        metaFbp: getCookie('_fbp'),
        metaFbc: getCookie('_fbc'),
        sourceUrl: window.location.href,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '系統暫時無法送出。');
    trackTikTokEvent('Lead', { event_id: result.browserEventId });
    currentLeadId = result.leadId;
    consultationCode.textContent = leadCode(result.leadId);
    message.textContent = '';
    modal.hidden = false;
  } catch (error) {
    message.textContent = error.message;
    submitButton.disabled = false;
  }
});

if (isWarningAccountBlocked()) lockApplication();
