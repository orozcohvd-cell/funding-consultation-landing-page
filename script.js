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
const closeModal = document.querySelector('#close-modal');
const submissionKey = 'funding-consultation-submitted';
const lineUrl = 'https://lin.ee/U9spsws';
let selectedFunding = '';

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

continueButton.addEventListener('click', showApplicationPage);
backButton.addEventListener('click', showLandingPage);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (localStorage.getItem(submissionKey)) {
    message.textContent = '此裝置已提交過申請。';
    return;
  }
  localStorage.setItem(submissionKey, 'true');
  modal.hidden = false;
  window.setTimeout(() => window.location.assign(lineUrl), 1500);
});

closeModal.addEventListener('click', () => {
  window.location.assign(lineUrl);
});
