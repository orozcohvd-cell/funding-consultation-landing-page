(function () {
  const amountDisplay = document.getElementById('amount-display');
  const amountRuler = document.querySelector('.amount-ruler');
  const amountButtons = Array.from(document.querySelectorAll('[data-amount]'));
  const monthButtons = Array.from(document.querySelectorAll('[data-months]'));
  const rateInput = document.getElementById('rate-input');
  const monthlyResult = document.getElementById('monthly-result');
  const totalResult = document.getElementById('total-result');
  const interestResult = document.getElementById('interest-result');
  const consultLink = document.getElementById('consult-link');
  const warningAccountBlockKey = 'funding-warning-account-blocked';
  const isWarningAccountBlocked = () => {
    try { return localStorage.getItem(warningAccountBlockKey) === '1'; } catch { return false; }
  };
  const number = new Intl.NumberFormat('zh-TW');
  const params = new URLSearchParams(window.location.search);
  const validAmounts = new Set(amountButtons.map(button => Number(button.dataset.amount)));
  const validMonths = new Set(monthButtons.map(button => Number(button.dataset.months)));
  const requestedAmount = Number(params.get('amount'));
  const requestedMonths = Number(params.get('months'));
  const requestedRate = Number(params.get('rate'));
  let amount = validAmounts.has(requestedAmount) ? requestedAmount : 1000000;
  let months = validMonths.has(requestedMonths) ? requestedMonths : 60;
  let draggingRuler = false;

  if (params.has('rate') && Number.isFinite(requestedRate) && requestedRate >= .1 && requestedRate <= 20) {
    rateInput.value = requestedRate.toFixed(1);
  }

  function currentRate() {
    const requested = Number(rateInput.value);
    return rateInput.value && Number.isFinite(requested) ? Math.min(20, Math.max(.1, requested)) : 2;
  }

  function updateCalculation() {
    const monthlyRate = currentRate() / 1200;
    const monthly = Math.round(amount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months)));
    const total = monthly * months;
    amountDisplay.textContent = number.format(amount);
    monthlyResult.textContent = number.format(monthly);
    totalResult.textContent = 'NT$ ' + number.format(total);
    interestResult.textContent = 'NT$ ' + number.format(total - amount);
    amountButtons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.amount) === amount)));
    monthButtons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.months) === months)));

    const nextPage = new URL('contact.html', window.location.href);
    for (const [key, value] of params) {
      if (/^(ttclid|tt_test_id|fbclid|gclid|utm_[a-z_]+)$/i.test(key)) {
        nextPage.searchParams.append(key, value);
      }
    }
    nextPage.searchParams.set('amount', String(amount));
    nextPage.searchParams.set('months', String(months));
    nextPage.searchParams.set('rate', String(currentRate()));
    if (!isWarningAccountBlocked()) consultLink.href = nextPage.href;
  }

  function selectAmount(button) {
    amount = Number(button.dataset.amount);
    updateCalculation();
  }

  function selectAmountAt(clientX) {
    let closest = amountButtons[0];
    let distance = Infinity;
    amountButtons.forEach(button => {
      const bounds = button.getBoundingClientRect();
      const nextDistance = Math.abs(clientX - (bounds.left + bounds.width / 2));
      if (nextDistance < distance) {
        closest = button;
        distance = nextDistance;
      }
    });
    selectAmount(closest);
  }

  amountButtons.forEach((button, index) => {
    button.addEventListener('click', () => selectAmount(button));
    button.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const nextIndex = Math.min(amountButtons.length - 1, Math.max(0, index + (event.key === 'ArrowRight' ? 1 : -1)));
      const next = amountButtons[nextIndex];
      selectAmount(next);
      next.focus();
    });
  });

  amountRuler.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    draggingRuler = true;
    amountRuler.setPointerCapture(event.pointerId);
    selectAmountAt(event.clientX);
  });
  amountRuler.addEventListener('pointermove', event => {
    if (draggingRuler) selectAmountAt(event.clientX);
  });
  amountRuler.addEventListener('pointerup', () => { draggingRuler = false; });
  amountRuler.addEventListener('pointercancel', () => { draggingRuler = false; });

  monthButtons.forEach(button => {
    button.addEventListener('click', () => {
      months = Number(button.dataset.months);
      updateCalculation();
    });
  });
  rateInput.addEventListener('input', updateCalculation);
  rateInput.addEventListener('blur', () => {
    rateInput.value = currentRate().toFixed(1);
    updateCalculation();
  });

  if (isWarningAccountBlocked()) {
    consultLink.removeAttribute('href');
    consultLink.setAttribute('aria-disabled', 'true');
    consultLink.firstChild.textContent = '目前無法繼續申請 ';
    consultLink.addEventListener('click', event => event.preventDefault());
  }

  if (window.location.hash === '#consult' && !isWarningAccountBlocked()) {
    const contactPage = new URL('contact.html', window.location.href);
    contactPage.search = window.location.search;
    window.location.replace(contactPage.href);
  }

  updateCalculation();
}());
