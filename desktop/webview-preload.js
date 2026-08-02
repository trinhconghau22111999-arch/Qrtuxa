// Preload rieng cho <webview> (trang dang duyet), KHONG phai preload cua cua so chinh.
// Chi lam 1 viec: khi nguoi dung submit 1 form co truong mat khau, goi ve host
// (index.html) qua ipcRenderer.sendToHost de hoi co muon luu mat khau khong.
// Khong dinh gi den logic tab/UI, giu that gon va an toan.
const { ipcRenderer } = require('electron');

function findUsernameField(form, pwInput) {
  const candidates = form.querySelectorAll(
    'input[type="text"], input[type="email"], input[autocomplete="username"], input:not([type])'
  );
  for (const el of candidates) {
    if (el !== pwInput && el.value) return el;
  }
  return null;
}

document.addEventListener('submit', (e) => {
  try {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const pwInput = form.querySelector('input[type="password"]');
    if (!pwInput || !pwInput.value) return;
    const userInput = findUsernameField(form, pwInput);
    ipcRenderer.sendToHost('qr-browser:password-capture', {
      origin: location.origin,
      username: userInput ? userInput.value : '',
      password: pwInput.value
    });
  } catch (err) { /* im lang, khong lam vo trang khach */ }
}, true);
