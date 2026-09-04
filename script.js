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
const submissionKey = 'funding-consultation-submitted';
const lineUrl = 'https://lin.ee/ynD1DjM';
let selectedFunding = '';

const trackTikTokEvent = (eventName, parameters = {}) => {
  if (typeof window.ttq?.track === 'function') {
    window.ttq.track(eventName, parameters);
  }
};

const getTikTokClickId = () => new URLSearchParams(window.location.search).get('ttclid') || '';
const getCookie = (name) => document.cookie.split('; ').find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || '';

const showLandingPage = () => {
  applicationPage.hidden = true;
  landingPage.hidden = false;
  window.scrollTo(0, 0);
};

const showApplicationPage = () => {
  landingPage.hidden = true;
  applicationPage.hidden = false;
  selectedAmount.textContent = selectedFunding;
  amountField.value = selectedFunding;
  window.scrollTo(0, 0);
};

amountButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectedFunding = button.dataset.amount;
    amountButtons.forEach((option) => option.classList.toggle('is-selected', option === button));
    continueButton.disabled = false;
  });
});

continueButton.addEventListener('click', () => {
  trackTikTokEvent('ViewContent');
  showApplicationPage();
});
backButton.addEventListener('click', showLandingPage);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (localStorage.getItem(submissionKey)) {
    message.textContent = '此裝置已提交過申請。';
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
    localStorage.setItem(submissionKey, 'true');
    trackTikTokEvent('Lead', { event_id: result.browserEventId });
    message.textContent = '';
    modal.hidden = false;
    window.setTimeout(() => window.location.assign(lineUrl), 1000);
  } catch (error) {
    message.textContent = error.message;
    submitButton.disabled = false;
  }
});
