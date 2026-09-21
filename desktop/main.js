const { app, BrowserWindow, Menu, ipcMain, clipboard, session, shell, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// An hoan toan thanh menu File/Edit/View/Window/Help tren moi cua so
Menu.setApplicationMenu(null);

// ====== Kho luu tru CUC BO tren may (bookmarks/history/passwords/theme/
// phishing-blocklist...) - LUU FILE THAT trong main process, vi renderer
// (index.html) chay voi contextIsolation:true + nodeIntegration:false nen
// KHONG THE tu goi require('fs') duoc (du code renderer co try/catch, no
// luon roi vao nhanh loi va am tham chuyen sang localStorage - day la loi
// that su cua ban build truoc, gio sua triet de bang cach nay).
// Moi may tinh co du lieu RIENG, KHONG dong bo qua may nao khac/dam may nao ca.
const APP_DATA_DIR = path.join(os.homedir(), '.ghn-browser');
// File log gon nhe ghi lai console.log/warn/error tu CHINH trang web dang
// xem, KHONG can mo DevTools that su - vi 1 so trang tu phat hien DevTools
// dang mo (do lech kich thuoc cua so) roi chan video, ghi log kieu nay
// (dung su kien noi bo 'console-message' cua Electron, khong bat DevTools
// that) tranh duoc bay do hoan toan.
const CONSOLE_LOG_FILE = path.join(APP_DATA_DIR, 'console-log.txt');
function appendConsoleLog(line) {
  try {
    if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.appendFileSync(CONSOLE_LOG_FILE, line + '\n', 'utf8');
    const stat = fs.statSync(CONSOLE_LOG_FILE);
    // Gioi han file khong qua 2MB, tranh phinh to sau nhieu phien dung -
    // giu lai phan MOI NHAT (1MB cuoi) khi vuot nguong.
    if (stat.size > 2 * 1024 * 1024) {
      const content = fs.readFileSync(CONSOLE_LOG_FILE, 'utf8');
      fs.writeFileSync(CONSOLE_LOG_FILE, content.slice(-1024 * 1024), 'utf8');
    }
  } catch (err) { /* log la tinh nang phu, loi thi bo qua, khong lam sap app */ }
}
function localStoreFile(key) {
  // chi cho phep ky tu chu/so/gach ngang trong ten key, tranh path traversal
  const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(APP_DATA_DIR, safeKey + '.json');
}

// Rieng mat khau (key 'passwords') MA HOA truoc khi ghi xuong dia, dung
// safeStorage co san cua Electron (Windows: DPAPI gan voi tai khoan Windows
// dang dang nhap - may khac/nguoi khac dang nhap Windows KHONG doc duoc, ke
// ca copy nguyen file .json sang; macOS/Linux: Keychain/libsecret tuong tu).
// Cac key khac (bookmarks/history/theme...) KHONG doi gi, van la JSON van ban
// thuong nhu truoc - chi rieng mat khau la du lieu nhay cam can bao ve them.
function readLocalStoreValue(key) {
  const file = localStoreFile(key);
  if (!fs.existsSync(file)) return null;
  if (key !== 'passwords') {
    try { return JSON.parse(fs.readFileSync(file, 'utf8') || 'null'); } catch (err) { return null; }
  }
  try {
    const buf = fs.readFileSync(file); // doc dang Buffer nhi phan (file ma hoa khong phai UTF-8 hop le)
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return JSON.parse(safeStorage.decryptString(buf));
      } catch (err) {
        // Giai ma that bai - co the la file CU tu ban truoc khi co ma hoa
        // (luc do van con la JSON van ban thuong) - doc lai kieu cu de KHONG
        // mat mat khau da luu tu truoc; lan ghi tiep theo se tu dong ma hoa lai.
        try { return JSON.parse(buf.toString('utf8')); } catch (err2) { return null; }
      }
    }
    // May khong ho tro ma hoa he thong (hiem, vd 1 so ban Linux khong co
    // keyring) - danh doc/ghi van ban thuong, van hoat dong binh thuong,
    // chi la khong duoc ma hoa them.
    return JSON.parse(buf.toString('utf8'));
  } catch (err) { return null; }
}
function writeLocalStoreValue(key, value) {
  const file = localStoreFile(key);
  if (key !== 'passwords') {
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(value)));
  } else {
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  }
}

ipcMain.handle('localstore:get', (e, key) => {
  try {
    ensureDirSafe(APP_DATA_DIR);
    return readLocalStoreValue(key);
  } catch (err) { return null; }
});
ipcMain.handle('localstore:get-all', (e, keys) => {
  const result = {};
  for (const key of keys || []) {
    try {
      ensureDirSafe(APP_DATA_DIR);
      result[key] = readLocalStoreValue(key);
    } catch (err) { result[key] = null; }
  }
  return result;
});
ipcMain.on('localstore:set', (e, { key, value }) => {
  try {
    ensureDirSafe(APP_DATA_DIR);
    writeLocalStoreValue(key, value);
  } catch (err) { /* 1 lan ghi loi khong lam sap app, bo qua */ }
});
function ensureDirSafe(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Xoa cache HTTP cua cac trang web dang duyet (webview dung chung partition
// 'persist:browse', xem DOWNLOAD_PARTITION ben duoi). CHI xoa cache mang
// (Cache-Control/disk cache) - KHONG dong cham cookie/localStorage/
// indexedDB/service worker cua trang, nen tai khoan dang dang nhap tren cac
// trang web (Facebook, Gmail...) VAN GIU NGUYEN, khong bi dang xuat. Du lieu
// rieng cua app (dau trang/lich su/mat khau da luu) nam trong APP_DATA_DIR,
// khong lien quan gi toi ham nay nen cung khong bi mat.
ipcMain.handle('cache:clear', async () => {
  try {
    const ses = session.fromPartition(DOWNLOAD_PARTITION);
    await ses.clearCache();
    await ses.clearStorageData({ storages: ['cachestorage'] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Mo file log console (bang app mac dinh, vd Notepad) va xoa trang lam moi
// truoc khi bat dau ghi lai 1 phien loi - xem CONSOLE_LOG_FILE phia tren.
ipcMain.handle('debuglog:open', async () => {
  try {
    if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    if (!fs.existsSync(CONSOLE_LOG_FILE)) fs.writeFileSync(CONSOLE_LOG_FILE, '', 'utf8');
    const err = await shell.openPath(CONSOLE_LOG_FILE);
    return { ok: !err, error: err || null };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('debuglog:clear', async () => {
  try {
    if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.writeFileSync(CONSOLE_LOG_FILE, '', 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ====== Theo doi Tai xuong (dung chung cho moi cua so vi cac webview deu
// dung chung 1 partition 'persist:browse') ======
const DOWNLOAD_PARTITION = 'persist:browse';
const downloads = new Map(); // id -> { id, filename, path, url, state, receivedBytes, totalBytes }
let downloadCounter = 0;
let downloadListenerAttached = false;

function broadcastDownloads() {
  const list = [...downloads.values()].sort((a, b) => b.id - a.id);
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('downloads:update', list));
}

function attachDownloadListenerOnce() {
  if (downloadListenerAttached) return;
  downloadListenerAttached = true;
  const ses = session.fromPartition(DOWNLOAD_PARTITION);
  ses.on('will-download', (event, item) => {
    const id = ++downloadCounter;
    const entry = {
      id,
      filename: item.getFilename(),
      path: item.getSavePath() || item.getFilename(),
      url: item.getURL(),
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes()
    };
    downloads.set(id, entry);
    broadcastDownloads();

    item.on('updated', (e, state) => {
      entry.state = state;
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      broadcastDownloads();
    });
    item.on('done', (e, state) => {
      entry.state = state; // 'completed' | 'cancelled' | 'interrupted'
      entry.path = item.getSavePath();
      // FIX (theo phan anh nguoi dung: "tai xong roi ma van hien 0%"): truoc
      // day o day CHI cap nhat state/path, quen cap nhat receivedBytes - neu
      // file tai qua nhanh (chua kip co su kien 'updated' bao tien do nao ca)
      // thi receivedBytes van giu nguyen 0 tu luc bat dau, khien giao dien
      // hien mai 0% du file da tai xong that su. Cap nhat lai cho dung o day.
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      broadcastDownloads();
    });

    entry._item = item;
  });
}

// ====== Chan quang cao: DA CHUYEN sang co che moi (tu dong bam "Bo qua quang
// cao" + tua nhanh + an banner/overlay ngay trong trang YouTube) - xem
// YOUTUBE_AD_SKIP_JS trong desktop/index.html, chay o renderer (executeJavaScript
// tren webview) chu khong con o main process nay nua. Toan bo danh sach domain
// chan theo mang (AD_BLOCK_DOMAINS_BUILTIN cu) va viec tai ban cap nhat tu
// docs/adblock-list.json da bo hoan toan.

// ====== Canh bao web den / lua dao ======
// KHONG co nguon du lieu "threat intel" thoi gian thuc (Google Safe Browsing
// can API key rieng ma app nay khong co san). Day la danh sach BAN TU QUAN LY
// qua panel Cai dat -> Chan web den, tuong tu cach Chrome hoi "Van tiep tuc?"
// khi vao 1 trang trong danh sach chan cua ban.
let phishingBlocklist = new Set();
const phishingAllowlistOnce = new Set(); // cac host nguoi dung bam "Van tiep tuc" - bo qua canh bao lan nay

function isPhishingHost(host) {
  if (!host) return false;
  host = host.toLowerCase();
  for (const d of phishingBlocklist) {
    if (host === d || host.endsWith('.' + d)) return true;
  }
  return false;
}

ipcMain.on('phishing:set-list', (e, list) => {
  phishingBlocklist = new Set((list || []).map(d => String(d).toLowerCase().trim()).filter(Boolean));
});
ipcMain.on('phishing:allow-once', (e, host) => {
  if (host) phishingAllowlistOnce.add(String(host).toLowerCase());
});

let requestFilterAttached = false;
function attachRequestFilterOnce() {
  if (requestFilterAttached) return;
  requestFilterAttached = true;
  const ses = session.fromPartition(DOWNLOAD_PARTITION);
  ses.webRequest.onBeforeRequest((details, callback) => {
    let host = '';
    try { host = new URL(details.url).hostname; } catch (e) {}

    // Web den / lua dao: chi chan o cap dieu huong trang chinh (mainFrame),
    // khong chan anh/script con trong trang khac de tranh lam vo trang khong lien quan.
    if (details.resourceType === 'mainFrame' && isPhishingHost(host)) {
      if (phishingAllowlistOnce.has(host.toLowerCase())) {
        // Nguoi dung da chon "Van tiep tuc" cho host nay -> cho qua lan nay
      } else {
        callback({ cancel: true });
        return;
      }
    }

    // Chan quang cao: DA CHUYEN sang co che moi chay o renderer (xem
    // YOUTUBE_AD_SKIP_JS trong desktop/index.html) - khong con chan theo
    // domain o day nua.

    callback({ cancel: false });
  });
}

// ====== Gia User-Agent giong trinh duyet Chrome that, bo dau vet Electron
// (nguoi dung phan anh: nhieu trang video/nguon phim VA ca tai file tu Google
// Drive deu bi tu choi phuc vu - "quay vong vong khong tai duoc") ======
// Mac dinh Electron TU GAN THEM 2 doan vao cuoi chuoi User-Agent chuan cua
// Chromium: " TenApp/PhienBan" (lay tu package.json - o day la
// "qr-remote-input-browser/1.0.0") va " Electron/PhienBanElectron". Nhieu
// dich vu (Google Drive/Docs, mot so CDN video chong bot...) do chuoi nay,
// thay khac voi trinh duyet that -> tu choi phuc vu hoac bat xac thuc them
// ma khong bao gio hoan tat, giao dien client chi thay nhu "dang tai mai
// khong xong". Cach xu ly CHUAN (khong phai gia mao trinh duyet khac, chi
// dung LAI dung phien ban Chromium ma Electron nay dang dung san, bo di 2
// doan rieng cua Electron): lay UA goc cua chinh session nay roi cat bo 2
// doan do, KHONG hardcode 1 chuoi UA co dinh de tranh lech phien ban thuc te
// (vd khi nang cap Electron len sau nay).
function stripElectronFromUserAgent(rawUA) {
  let ua = rawUA;
  // Bo " Electron/x.y.z"
  ua = ua.replace(/\s*Electron\/\S+/i, '');
  // Bo " TenApp/PhienBan" - ten/phien ban lay dung tu package.json cua CHINH
  // app nay (co the doi ten/phien ban sau nay, nen lay dong chu khong hardcode).
  const appToken = `${app.getName()}/${app.getVersion()}`;
  const escaped = appToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  ua = ua.replace(new RegExp('\\s*' + escaped, 'i'), '');
  return ua.replace(/\s{2,}/g, ' ').trim();
}
let userAgentOverrideAttached = false;
function attachUserAgentOverrideOnce() {
  if (userAgentOverrideAttached) return;
  userAgentOverrideAttached = true;
  const ses = session.fromPartition(DOWNLOAD_PARTITION);
  const cleanUA = stripElectronFromUserAgent(ses.getUserAgent());
  ses.setUserAgent(cleanUA);
}

// ====== Ep 4 trang Telegram/Zalo/Facebook/YouTube (nut chia doi man hinh o
// toolbar) hien THEO GIAO DIEN TIENG VIET ======
// Nhieu trang doc ngon ngu uu tien tu header HTTP "Accept-Language" cua trinh
// duyet (Telegram Web, Zalo Web la 2 vi du - khong co tham so URL nao doi
// ngon ngu duoc ca), nen cach chac chan nhat la ep header nay thanh tieng
// Viet CHI RIENG cho 4 domain nay (dung "urls" filter, KHONG anh huong cac
// trang khac nguoi dung dang xem trong cac tab thuong).
const VIETNAMESE_LANG_URL_PATTERNS = [
  '*://web.telegram.org/*',
  '*://*.telegram.org/*',
  '*://chat.zalo.me/*',
  '*://*.zalo.me/*',
  '*://*.facebook.com/*',
  '*://*.youtube.com/*'
];
let vietnameseLangHeaderAttached = false;
function attachVietnameseLangHeaderOnce() {
  if (vietnameseLangHeaderAttached) return;
  vietnameseLangHeaderAttached = true;
  const ses = session.fromPartition(DOWNLOAD_PARTITION);
  ses.webRequest.onBeforeSendHeaders({ urls: VIETNAMESE_LANG_URL_PATTERNS }, (details, callback) => {
    details.requestHeaders['Accept-Language'] = 'vi-VN,vi;q=0.9';
    callback({ requestHeaders: details.requestHeaders });
  });
}

// Chup anh trang web: renderer da tu chup xong (webview.capturePage() ->
// dataURL), o day chi lo hien hop thoai "Luu thanh..." de nguoi dung chon
// noi luu, roi ghi file PNG that xuong dung cho do (renderer khong co quyen
// ghi file truc tiep vi contextIsolation dang bat).
ipcMain.handle('screenshot:save', async (e, dataUrl) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    const defaultName = `screenshot-${Date.now()}.png`;
    const result = await dialog.showSaveDialog(win, {
      title: 'Lưu ảnh chụp trang web',
      defaultPath: path.join(app.getPath('pictures'), defaultName),
      filters: [{ name: 'Ảnh PNG', extensions: ['png'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false };
    const base64 = String(dataUrl || '').replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// ====== Cac lenh IPC dieu khien cua so / quay video / luu anh - DUNG CHUNG
// cho MOI cua so (ke ca cua so tach tu 1 tab ra) ======
// LOI NGHIEM TRONG DA SUA (nguoi dung phan anh: "video/trang web quay vong
// vong khong tai duoc", kem anh chup loi that "A JavaScript error occurred
// in the main process... Attempted to register a second handler for
// 'win:get-bounds'" va "TypeError: Object has been destroyed"):
// TRUOC DAY toan bo cac ipcMain.on/ipcMain.handle ben duoi nam BEN TRONG ham
// createWindow(), dong lai bien `win` cua CHINH LAN GOI DO qua closure. Ham
// createWindow() lai duoc goi THEM MOI LAN nguoi dung keo 1 tab tach thanh
// cua so rieng (xem ipcMain.on('tab:detach',...) o cuoi file) - nghia la moi
// lan tach tab, TOAN BO cac dong ipcMain.handle(...) ben duoi bi chay dang
// ky LAN THU HAI. Electron CHI cho phep 1 handler duy nhat cho moi ten kenh
// ('win:get-bounds' la kenh dau tien gap phai) - dang ky lan 2 nem loi NGAY
// LAP TUC, lam dut quang giua chung viec khoi tao cua so moi (cac dong dang
// ky con lai phia sau khong con chay duoc nua) va dan den loi "Object has
// been destroyed" ve sau khi trang goi lai nhung lenh chua kip dang ky xong/
// dang ky vao cua so da bi dong. Sua tan goc: dua HET cac dang ky nay ra
// NGOAI createWindow(), CHI dang ky DUY NHAT 1 LAN cho toan bo app (giong
// cac ham *Once() khac trong file nay), va MOI handler tu tim dung cua so
// cua chinh no qua BrowserWindow.fromWebContents(e.sender) thay vi khoa
// cung vao 1 bien `win` co dinh - hoat dong dung cho MOI cua so, du la cua
// so chinh hay cua so tach tu tab.
//
// Rieng du lieu quay video/nhan tep (activeRecordingFiles) chuyen tu bien
// cuc bo trong tung cua so thanh 1 Map DUNG CHUNG toan app - an toan vi
// recordingId da bao gom timestamp + so dem tang dan nen luon duy nhat, du
// phat sinh tu cua so nao.
const activeRecordingFiles = new Map(); // recordingId -> { fd, filePath }
let recordingIdCounter = 0;

let windowControlsIpcAttached = false;
function attachWindowControlsIpcOnce() {
  if (windowControlsIpcAttached) return;
  windowControlsIpcAttached = true;

  // ====== Menu chuot phai (giong Chrome) khi bam vao link/vung chu ben trong webview ======
  ipcMain.on('context-menu:show', (e, params) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const template = [];

    if (params && params.linkURL) {
      template.push({
        label: 'Mở liên kết trong tab mới',
        click: () => win.webContents.send('context-menu:action', { action: 'open-new-tab', url: params.linkURL })
      });
      template.push({
        label: 'Sao chép địa chỉ liên kết',
        click: () => clipboard.writeText(params.linkURL)
      });
      template.push({ type: 'separator' });
    }

    if (params && params.selectionText) {
      template.push({
        label: 'Sao chép',
        click: () => clipboard.writeText(params.selectionText)
      });
      template.push({ type: 'separator' });
    }

    template.push({ label: 'Quay lại', click: () => win.webContents.send('context-menu:action', { action: 'go-back' }) });
    template.push({ label: 'Tiến tới', click: () => win.webContents.send('context-menu:action', { action: 'go-forward' }) });
    template.push({ label: 'Tải lại', click: () => win.webContents.send('context-menu:action', { action: 'reload' }) });
    template.push({ type: 'separator' });
    template.push({ label: 'In trang...', click: () => win.webContents.send('context-menu:action', { action: 'print' }) });

    Menu.buildFromTemplate(template).popup({ window: win });
  });

  // ====== Dieu khien cua so tu thanh tieu de tu ve (minimize / maximize / close) ======
  ipcMain.on('win:minimize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.minimize();
  });
  ipcMain.on('win:toggleMaximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('win:close', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.close();
  });

  // ====== Ho tro tay cam keo-gian vien cua so tu ve trong renderer ======
  // (can vi cua so frame:false + noi dung phu kin sat mep khien HDH khong
  // con nhan dien duoc thao tac keo-gian mac dinh o vien nua - xem index.html)
  ipcMain.handle('win:get-bounds', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win ? win.getBounds() : null;
  });
  ipcMain.on('win:set-bounds', (e, bounds) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || !bounds) return;
    const MIN_W = 480, MIN_H = 360;
    win.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(MIN_W, Math.round(bounds.width)),
      height: Math.max(MIN_H, Math.round(bounds.height))
    });
  });

  // ====== Quay video tung o xem QR Cam: chon thu muc luu + ghi file that ======
  // (renderer chi ghi hinh bang MediaRecorder trong bo nho - khong the tu
  // ghi file xuong dia vi contextIsolation dang bat, giong moi thu khac)
  //
  // SUA LOI "quay cang lau ton RAM cang nhieu": TRUOC DAY renderer gom HET
  // cac doan video trong 1 mang o RAM suot ca luc quay, chi ghi xuong dia
  // MOT LAN DUY NHAT luc bam dung - quay hang gio (dung cho tinh nang lich
  // quay) se lam RAM tang dan khong gioi han, va luc dung phai gop + doi
  // base64 + ghi 1 khoi khong lo cung luc co the lam may khung mot chut.
  // Gio doi sang ghi TUNG DOAN (moi 1 giay) THANG XUONG DIA ngay khi co,
  // noi tiep vao file dang mo (giu 1 file descriptor mo suot phien quay) -
  // giong het ky thuat "noi truc tiep chunk MediaRecorder vao file" da dung
  // truoc do cho he thong camrec cu: chi doan DAU TIEN cua ca phien co tieu
  // de container (EBML header cua WebM), cac doan sau chi la du lieu noi
  // tiep tho - noi truc tiep theo dung thu tu tao thanh 1 file .webm hop le,
  // khong can gop toan bo truoc. RAM chi giu 1 doan nho (~1 giay) tai 1 thoi
  // diem, khong con tang theo thoi gian quay nua.
  ipcMain.handle('recording:choose-folder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Chọn nơi lưu video ghi hình',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('recording:start-file', (e, { folder, filename }) => {
    if (!BrowserWindow.fromWebContents(e.sender)) return { ok: false, error: 'invalid sender' };
    try {
      if (!folder || !filename) return { ok: false, error: 'missing folder/filename' };
      fs.mkdirSync(folder, { recursive: true });
      const filePath = path.join(folder, filename);
      const fd = fs.openSync(filePath, 'w');
      const recordingId = 'rec_' + (++recordingIdCounter) + '_' + Date.now();
      activeRecordingFiles.set(recordingId, { fd, filePath });
      return { ok: true, recordingId, path: filePath };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('recording:append-chunk', (e, { recordingId, base64Data }) => {
    if (!BrowserWindow.fromWebContents(e.sender)) return { ok: false, error: 'invalid sender' };
    const entry = activeRecordingFiles.get(recordingId);
    if (!entry) return { ok: false, error: 'recording not found (da finish hoac chua start)' };
    try {
      fs.writeSync(entry.fd, Buffer.from(base64Data, 'base64'));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('recording:finish-file', (e, recordingId) => {
    if (!BrowserWindow.fromWebContents(e.sender)) return { ok: false, error: 'invalid sender' };
    const entry = activeRecordingFiles.get(recordingId);
    if (!entry) return { ok: false, error: 'recording not found' };
    try { fs.closeSync(entry.fd); } catch (err) {}
    activeRecordingFiles.delete(recordingId);
    return { ok: true, path: entry.filePath };
  });

  // Ghi 1 file NGUYEN VEN trong 1 lan (khong mo fd roi ghi tung doan qua
  // nhieu vong IPC + fs.writeSync dong bo nhu recording:append-chunk o tren -
  // cach do phu hop cho quay video LIEN TUC/rat dai, khong the gom het trong
  // RAM, nhung lai la nut that co chai KHONG CAN THIET cho tep/anh nhan tu
  // dien thoai qua DataChannel: 1 anh vai tram KB - vai MB chia lam vai chuc
  // doan 64KB, moi doan truoc day phai round-trip IPC + writeSync RIENG,
  // cong don lai lam cham han. Voi truong hop nay renderer da gom san toan
  // bo du lieu trong RAM (mang cac ArrayBuffer chunk) roi moi goi xuong day
  // DUNG 1 LAN - `data` la Uint8Array/Buffer truyen thang qua IPC (khong can
  // ma hoa base64, tranh phinh ~33% kich thuoc + chi phi encode/decode).
  ipcMain.handle('recording:save-whole-file', (e, { folder, filename, data }) => {
    if (!BrowserWindow.fromWebContents(e.sender)) return { ok: false, error: 'invalid sender' };
    try {
      if (!folder || !filename || !data) return { ok: false, error: 'missing folder/filename/data' };
      fs.mkdirSync(folder, { recursive: true });
      const filePath = path.join(folder, filename);
      fs.writeFileSync(filePath, Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength ?? data.length));
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Huy 1 phien nhan tep dang do (VD dien thoai bao file-cancel, hoac ket
  // noi rot giua chung) - dong file NHUNG XOA LUON phan da nhan, khong giu
  // lai file loi/thieu tren dia. Dung cho ca tinh nang nhan tep/anh moi
  // (Giai doan 3) - KHONG dung cho tinh nang quay video hien co (van dung
  // finish-file nhu cu, khong doi gi).
  ipcMain.handle('recording:cancel-file', (e, recordingId) => {
    if (!BrowserWindow.fromWebContents(e.sender)) return { ok: false, error: 'invalid sender' };
    const entry = activeRecordingFiles.get(recordingId);
    if (!entry) return { ok: false, error: 'recording not found' };
    try { fs.closeSync(entry.fd); } catch (err) {}
    activeRecordingFiles.delete(recordingId);
    try { fs.unlinkSync(entry.filePath); } catch (err) {}
    return { ok: true };
  });

  // ====== Sua anh nhan tu dien thoai (Giai doan 5): cat/xoay/ve/nhap lieu ======
  // Ghi DE thang len dung file da nhan (khong hien hop thoai "Luu thanh" vi
  // day la sua-tai-cho, khac voi tinh nang chup man hinh trang web).
  ipcMain.handle('imageEdit:save', (e, { path: filePath, dataUrl }) => {
    if (!BrowserWindow.fromWebContents(e.sender)) return { ok: false, error: 'invalid sender' };
    try {
      const base64 = String(dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Phong khi app bi tat dot ngot (hoac nguoi dung thoat) trong luc van con
  // file dang ghi do (VD do disconnectSlot() reset slot truoc khi kip goi
  // finish-file ve day) - dong het cac file descriptor con mo lai, tranh ro
  // ri tai nguyen. Du liệu đã ghi bằng fs.writeSync là đồng bộ nên đã nằm
  // trên đĩa từ trước, chỉ thiếu bước đóng fd cho gọn.
  app.on('before-quit', () => {
    for (const entry of activeRecordingFiles.values()) {
      try { fs.closeSync(entry.fd); } catch (err) {}
    }
    activeRecordingFiles.clear();
  });
}

function createWindow(initialUrl) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 360,
    resizable: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const query = initialUrl ? { initialUrl } : undefined;
  win.loadFile('index.html', query ? { query } : undefined);

  attachDownloadListenerOnce();
  attachRequestFilterOnce();
  attachVietnameseLangHeaderOnce();
  attachWindowControlsIpcOnce();
  attachUserAgentOverrideOnce();

  // Cho phep cua so popup THAT (vd: window.open co kich thuoc rieng de xem
  // anh POD) duoc mo va hien thi binh thuong. Con lai - click link co
  // target="_blank", giua-click chuot, ctrl/cmd+click - Chromium coi la yeu
  // cau mo "tab" (disposition 'foreground-tab' / 'background-tab') chu
  // khong phai popup that, nen ta CHAN khong cho bat cua so Electron moi ma
  // bao renderer (index.html) tu mo 1 TAB MOI trong chinh app, giong hanh vi
  // trinh duyet Chrome.
  win.webContents.on('did-attach-webview', (event, webContents) => {
    // Ghi log console cua trang (xem giai thich o phan khai bao CONSOLE_LOG_FILE
    // phia tren) - hoan toan tham lang, khong bat DevTools, khong bi trang phat hien.
    webContents.on('console-message', (e, level, message, line, sourceId) => {
      const levelNames = { 0: 'LOG', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };
      const levelName = levelNames[level] || ('LEVEL' + level);
      const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
      const shortSource = String(sourceId || '').split('/').pop();
      appendConsoleLog(`[${time}] [${levelName}] ${message}  (${shortSource}:${line})`);
    });
    webContents.setWindowOpenHandler((details) => {
      const isRealPopup = details.disposition === 'new-window' || details.disposition === 'other';
      if (isRealPopup) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 900,
            height: 700,
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false
            }
          }
        };
      }
      if (details.url) win.webContents.send('open-new-tab', details.url);
      return { action: 'deny' };
    });
  });

  win.on('maximize', () => win.webContents.send('win:maximized-state', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized-state', false));

  return win;
}

// ====== Tach 1 tab thanh cua so rieng (keo tab ra khoi thanh tab / keo qua
// cua so khac ma khong co cua so nao nhan -> mo cua so moi voi URL do) ======
ipcMain.on('tab:detach', (e, url) => {
  if (!url) return;
  createWindow(url);
});

// ====== Tai xuong: mo thu muc chua file / mo file / huy tai / xoa muc da xong ======
ipcMain.on('downloads:show-in-folder', (e, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});
ipcMain.on('downloads:open-file', (e, filePath) => {
  if (filePath) shell.openPath(filePath);
});
ipcMain.on('downloads:cancel', (e, id) => {
  const entry = downloads.get(id);
  if (entry && entry._item && entry.state === 'progressing') entry._item.cancel();
});
ipcMain.on('downloads:clear-finished', () => {
  for (const [id, entry] of downloads) {
    if (entry.state !== 'progressing') downloads.delete(id);
  }
  broadcastDownloads();
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
