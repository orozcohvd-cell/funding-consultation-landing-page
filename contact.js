(function () {
  const params = new URLSearchParams(window.location.search);
  const validAmounts = new Set([100000, 200000, 300000, 500000, 1000000, 1500000, 3000000]);
  const validMonths = new Set([36, 48, 60, 120]);
  const requestedAmount = Number(params.get('amount'));
  const requestedMonths = Number(params.get('months'));
  const requestedRate = Number(params.get('rate'));
  const amount = validAmounts.has(requestedAmount) ? requestedAmount : 1000000;
  const months = validMonths.has(requestedMonths) ? requestedMonths : 60;
  const rate = params.has('rate') && Number.isFinite(requestedRate) && requestedRate >= .1 && requestedRate <= 20 ? requestedRate : 2;
  const number = new Intl.NumberFormat('zh-TW');
  const warningAccountBlockKey = 'funding-warning-account-blocked';
  const summary = document.getElementById('estimate-summary');
  const backLink = document.getElementById('back-link');
  const brandLink = document.querySelector('.brand');
  const form = document.getElementById('lead-form');
  const message = document.querySelector('.form-message');
  const successModal = document.getElementById('success-modal');
  const eligibilityModal = document.getElementById('eligibility-modal');
  const consultationCode = document.getElementById('consultation-code');
  const lineCta = document.getElementById('line-cta');
  const modalHint = document.querySelector('.modal-hint');
  let currentLeadId = '';
  let submitted = false;

  const isWarningAccountBlocked = () => {
    try { return localStorage.getItem(warningAccountBlockKey) === '1'; } catch { return false; }
  };
  if (isWarningAccountBlocked()) {
    window.location.replace('/');
    return;
  }

  summary.querySelector('.summary-amount').textContent = 'NT$ ' + number.format(amount);
  summary.querySelector('.summary-months').textContent = months + ' 期';
  summary.querySelector('.summary-rate').textContent = '假設年利率 ' + rate.toFixed(1) + '%';
  form.elements.amount.value = String(amount);

  const returnPage = new URL('/', window.location.href);
  for (const [key, value] of params) {
    if (/^(ttclid|tt_test_id|fbclid|gclid|utm_[a-z_]+)$/i.test(key)) {
      returnPage.searchParams.append(key, value);
    }
  }
  returnPage.searchParams.set('amount', String(amount));
  returnPage.searchParams.set('months', String(months));
  returnPage.searchParams.set('rate', String(rate));
  backLink.href = returnPage.href + '#estimate';
  brandLink.href = returnPage.href;

  const trackTikTokEvent = (eventName, parameters = {}) => {
    if (typeof window.ttq?.track === 'function') window.ttq.track(eventName, parameters);
  };
  trackTikTokEvent('ViewContent');

  const sha256 = async (value) => {
    if (!window.crypto?.subtle || typeof TextEncoder === 'undefined') return '';
    const data = new TextEncoder().encode(String(value));
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const taiwanPhoneToE164 = (value) => {
    const normalized = String(value || '').trim().replace(/[\s()-]/g, '');
    if (/^09\d{8}$/.test(normalized)) return `+886${normalized.slice(1)}`;
    if (/^\+88609\d{8}$/.test(normalized)) return `+886${normalized.slice(5)}`;
    if (/^88609\d{8}$/.test(normalized)) return `+886${normalized.slice(4)}`;
    if (/^\+8869\d{8}$/.test(normalized)) return normalized;
    if (/^8869\d{8}$/.test(normalized)) return `+${normalized}`;
    return '';
  };
  const identifyTikTokLead = async ({ phone, leadId }) => {
    if (typeof window.ttq?.identify !== 'function' || !leadId) return;
    try {
      const e164Phone = taiwanPhoneToE164(phone);
      const [phoneNumber, externalId] = await Promise.all([
        e164Phone ? sha256(e164Phone) : '',
        sha256(`lead:${leadId}`),
      ]);
      const identifiers = {};
      if (phoneNumber) identifiers.phone_number = phoneNumber;
      if (externalId) identifiers.external_id = externalId;
      if (Object.keys(identifiers).length) window.ttq.identify(identifiers);
    } catch (error) {
      console.warn('TikTok manual advanced matching was unavailable.', error);
    }
  };
  const getCookie = (name) => document.cookie.split('; ').find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || '';
  const leadCode = (leadId) => `L-${String(leadId || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const copyConsultCode = async (code) => {
    const text = `諮詢編號：${code}`;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const field = document.createElement('textarea');
      field.value = text;
      field.readOnly = true;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* Clipboard access unavailable. */ }
      field.remove();
      return copied;
    }
  };

  const recordLineClick = () => {
    if (!currentLeadId) return;
    const endpoint = `/api/leads/${encodeURIComponent(currentLeadId)}/line-click`;
    const body = JSON.stringify({});
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  };

  lineCta.addEventListener('click', async (event) => {
    if (!currentLeadId) return;
    event.preventDefault();
    recordLineClick();
    await copyConsultCode(consultationCode.textContent);
    window.location.assign(lineCta.href);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitted || !form.reportValidity()) return;
    if (form.elements['warning-account'].value === 'yes') {
      try { localStorage.setItem(warningAccountBlockKey, '1'); } catch { /* Server still rejects warning accounts. */ }
      form.reset();
      eligibilityModal.hidden = false;
      window.setTimeout(() => window.location.replace('/'), 2600);
      return;
    }

    const submitButton = form.querySelector('[type="submit"]');
    const data = new FormData(form);
    submitButton.disabled = true;
    message.textContent = '正在送出申請…';
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.get('name'),
          age: Number(data.get('age')),
          phone: data.get('phone'),
          amount: data.get('amount'),
          months,
          assumedAnnualRate: rate,
          warningAccount: false,
          tiktokClickId: params.get('ttclid') || '',
          metaFbp: getCookie('_fbp'),
          metaFbc: getCookie('_fbc'),
          sourceUrl: window.location.href,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '系統暫時無法送出。');
      submitted = true;
      currentLeadId = result.leadId;
      consultationCode.textContent = leadCode(result.leadId);
      if (data.get('tiktok-match-consent') === 'on') {
        await identifyTikTokLead({ phone: data.get('phone'), leadId: result.leadId });
      }
      trackTikTokEvent('Lead', { event_id: result.browserEventId });
      message.textContent = '';
      successModal.hidden = false;
      lineCta.focus();
      const copied = await copyConsultCode(consultationCode.textContent);
      if (!copied) modalHint.textContent = '請按上方按鈕複製編號 加入好友後直接貼上並傳送給專員';
    } catch (error) {
      message.textContent = error.message;
      submitButton.disabled = false;
    }
  });
}());
