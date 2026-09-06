// Preload rieng cho <webview> (trang dang duyet), KHONG phai preload cua cua so chinh.
// Lam 3 viec:
// 1) Khi nguoi dung submit 1 form co truong mat khau, goi ve host (index.html)
//    qua ipcRenderer.sendToHost de hoi co muon luu mat khau khong.
// 2) Theo doi khi 1 truong mat khau XUAT HIEN MUON tren trang (dang nhap 2
//    buoc kieu Google: nhap email truoc, bam Tiep theo moi hien o mat khau) -
//    bao ve host de thu tu dong dien lai, vi lan dau trang tai xong co the
//    chua co o mat khau nao de dien.
// 3) "Mo link bang 1 cham" (xem renderOneClickOpenPanel o desktop/index.html):
//    khi host tat tinh nang nay, chan dung MOI cham/click trai vao link
//    (<a href>) tren trang - dung luc xem phim o cac trang co gai quang cao
//    an/lop phu link, tranh lo cham la bi mo tran lan trang quang cao. Menu
//    chuot phai "Mo lien ket trong tab moi" van hoat dong binh thuong du bat
//    hay tat (do la 1 su kien 'contextmenu' rieng, khong bi chan o day).
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

// ====== "Mo link bang 1 cham" - mac dinh BAT (giu dung hanh vi binh thuong).
// Host (index.html) goi el.send('qr-browser:set-one-click-open', bool) ngay
// luc trang tai xong (dom-ready) VA moi lan bat/tat trong Cai dat - xem
// createWebviewElement()/renderOneClickOpenPanel() o desktop/index.html.
let oneClickOpenEnabled = true;
ipcRenderer.on('qr-browser:set-one-click-open', (e, enabled) => {
  oneClickOpenEnabled = enabled !== false;
});

// Bat o pha CAPTURE (chay TRUOC moi script cua chinh trang) de chan dung
// truoc khi bat ky onclick/addEventListener nao cua trang kip chay - nhieu
// trang xem phim lau/rap cai luon script mo quang cao NGAY tren su kien click
// nay, nen phai chan tu som nhat co the. stopImmediatePropagation() de dung
// luon ca cac listener khac cung dang ky tren CHINH phan tu nay (khong chi
// preventDefault ngan dieu huong mac dinh cua trinh duyet).
document.addEventListener('click', (e) => {
  if (oneClickOpenEnabled) return;
  const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!link) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
