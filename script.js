const form = document.querySelector('#lead-form');
const message = document.querySelector('.form-message');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  message.textContent = '已收到您的諮詢資料，正在為您導向 LINE，請稍候...';
  form.reset();
  setTimeout(() => {
    window.location.href = 'https://lin.ee/U9spsws';
  }, 1000);
});
