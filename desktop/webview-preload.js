// Preload rieng cho <webview> (trang dang duyet), KHONG phai preload cua cua so chinh.
// Lam 2 viec:
// 1) Khi nguoi dung submit 1 form co truong mat khau, goi ve host (index.html)
//    qua ipcRenderer.sendToHost de hoi co muon luu mat khau khong.
// 2) Theo doi khi 1 truong mat khau XUAT HIEN MUON tren trang (dang nhap 2
//    buoc kieu Google: nhap email truoc, bam Tiep theo moi hien o mat khau) -
//    bao ve host de thu tu dong dien lai, vi lan dau trang tai xong co the
//    chua co o mat khau nao de dien.
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

// ====== Bat o mat khau xuat hien muon (dang nhap nhieu buoc) ======
let lastNotifiedForPwPresence = false;
function checkPasswordFieldPresence() {
  try {
    const hasPw = !!document.querySelector('input[type="password"]');
    if (hasPw && !lastNotifiedForPwPresence) {
      lastNotifiedForPwPresence = true;
      ipcRenderer.sendToHost('qr-browser:password-field-appeared', { origin: location.origin });
    } else if (!hasPw) {
      lastNotifiedForPwPresence = false; // co the xuat hien lai o buoc sau, reset de bao lai duoc
    }
  } catch (err) { /* im lang */ }
}
try {
  const observer = new MutationObserver(() => checkPasswordFieldPresence());
  const startObserving = () => {
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
      checkPasswordFieldPresence();
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving);
  } else {
    startObserving();
  }
} catch (err) { /* trinh duyet khong ho tro MutationObserver (rat hiem) -> bo qua tinh nang nay */ }
