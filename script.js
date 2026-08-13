const form = document.querySelector('#lead-form');
const message = document.querySelector('.form-message');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  message.textContent = '已收到您的諮詢資料，專人將於服務時間內與您聯繫。';
  form.reset();
});
