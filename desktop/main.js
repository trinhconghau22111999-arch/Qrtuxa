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

// ====== QR Cam: nhan khung hinh tu dien thoai (qua Firebase, do renderer lang
// nghe) va LUU XUONG DIA O DAY (main process), vi day la noi duy nhat co quyen
// ghi file that trong app nay. Moi khung hinh la 1 file rieng -> du bi ngat
// dot ngot (dien thoai rut nguon, mat mang...) thi cac khung da nhan van
// nguyen ven, khong hong. Khi 1 "lan ghi" (take) ket thuc (dien thoai bat dau
// 1 lan ghi moi), tu dong ghep cac khung thanh 1 file video .mp4 bang ffmpeg
// NEU may co san ffmpeg trong PATH; neu khong co thi giu nguyen thu muc anh.
const CAM_REC_ROOT = path.join(os.homedir(), '.ghn-browser', 'qr-cam-recordings');
// camId -> { takeId, dir, filePath, fd, ext, chunkCount, startedAt, partNumber, lastTs }
const activeTakes = new Map();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function takeDir(camId, takeId) {
  return path.join(CAM_REC_ROOT, camId, takeId);
}

function openNewPart(entry) {
  try { if (entry.fd !== null && entry.fd !== undefined) fs.closeSync(entry.fd); } catch (e) {}
  entry.partNumber++;
  const filename = entry.partNumber === 1 ? `video.${entry.ext}` : `video_part${entry.partNumber}.${entry.ext}`;
  entry.filePath = path.join(entry.dir, filename);
  entry.fd = fs.openSync(entry.filePath, 'w');
}

// Cac doan video (chunk) do MediaRecorder ben dien thoai cat ra, khi noi
// TRUC TIEP theo dung thu tu vao 1 file duy nhat se tao thanh 1 file video
// lien tuc, xem duoc binh thuong (day la ky thuat pho bien de ghi video
// truc tiep xuong dia tu 1 phien MediaRecorder duy nhat) - KHONG can ffmpeg
// hay bat ky buoc ghep noi phuc tap nao khac. Cu moi 60 phut se tu dong mo
// 1 file moi (video_part2.webm, part3...) thay vi de 1 file khong lo mai.
function finalizeTake(camId) {
  const entry = activeTakes.get(camId);
  if (!entry) return;
  try {
    if (entry.fd !== null && entry.fd !== undefined) fs.closeSync(entry.fd);
  } catch (e) {}
  try {
    fs.writeFileSync(
      path.join(entry.dir, 'manifest.json'),
      JSON.stringify({
        camId, takeId: entry.takeId, ext: entry.ext, parts: entry.partNumber,
        chunkCount: entry.chunkCount, startedAt: entry.startedAt, lastTs: entry.lastTs
      }, null, 2),
      'utf8'
    );
  } catch (e) {}
  activeTakes.delete(camId);
}

ipcMain.on('camrec:new-take', (e, { camId, takeId, ext }) => {
  if (!camId || !takeId) return;
  const existing = activeTakes.get(camId);
  if (existing && existing.takeId === takeId) return; // da biet lan ghi nay roi
  if (existing) finalizeTake(camId); // dien thoai bat dau lan ghi MOI -> chot lan ghi truoc lai, mo file moi
  const dir = takeDir(camId, takeId);
  ensureDir(dir);
  const safeExt = (ext === 'mp4') ? 'mp4' : 'webm';
  const entry = {
    takeId, dir, filePath: null, fd: null, ext: safeExt,
    chunkCount: 0, startedAt: Date.now(), partNumber: 0, lastTs: Date.now()
  };
  openNewPart(entry);
  activeTakes.set(camId, entry);
});

ipcMain.on('camrec:chunk', (e, { camId, takeId, ts, dataBase64 }) => {
  if (!camId || !takeId || !dataBase64) return;
  let entry = activeTakes.get(camId);
  if (!entry || entry.takeId !== takeId) {
    // Chua thay currentTake truoc do (vd. race luc moi ket noi) -> tu tao file luon (mac dinh webm).
    const dir = takeDir(camId, takeId);
    ensureDir(dir);
    entry = { takeId, dir, filePath: null, fd: null, ext: 'webm', chunkCount: 0, startedAt: Date.now(), partNumber: 0, lastTs: Date.now() };
    openNewPart(entry);
    activeTakes.set(camId, entry);
  }
  // LỖI ĐÃ SỬA ("máy tính nhận nhiều đoạn video nhưng không xem trực tiếp được - báo lỗi tệp"):
  // TRƯỚC ĐÂY cứ 60 phút lại tự openNewPart() mở 1 file .webm HOÀN TOÀN MỚI giữa dòng quay -
  // nhưng MediaRecorder CHỈ ghi phần "tiêu đề" (EBML header/tracks cho WebM, ftyp/moov cho MP4)
  // ở ĐÚNG ĐOẠN ĐẦU TIÊN của CẢ PHIÊN quay (video.webm) - mọi đoạn SAU đó chỉ là dữ liệu tiếp
  // nối thô, KHÔNG có tiêu đề riêng. Mở file MỚI giữa chừng rồi nối các đoạn thô đó vào -> file
  // video_part2.webm/part3... không có tiêu đề hợp lệ, mọi trình phát video đều báo lỗi/không mở
  // được. Bỏ hẳn việc tự tách file giữa 1 phiên quay - chỉ mở file mới khi ĐIỆN THOẠI thật sự
  // bắt đầu 1 "lần ghi" (take) MỚI (MediaRecorder mới, có tiêu đề mới hẳn hoi - xem
  // ipcMain.on('camrec:new-take')), file 1 lần ghi cứ nối dài liên tục cho tới khi kết thúc.
  try {
    // Noi truc tiep (append) doan video moi vao CUOI file hien co, dung thu
    // tu nhan duoc - moi khi mot doan da duoc ghi an toan xuong dia, du dien
    // thoai co ngat ket noi dot ngot ngay sau do thi phan da nhan van nguyen ven.
    fs.writeSync(entry.fd, Buffer.from(dataBase64, 'base64'));
    entry.chunkCount++;
    entry.lastTs = ts || Date.now();
  } catch (err) { /* 1 doan loi ghi khong lam hong ca file, bo qua va tiep tuc doan sau */ }
});

// Dung han 1 camId (nguoi dung bam "Tao ma QR moi" tren may tinh) -> chot lai
// lan ghi dang do (neu co) va dong file lai cho an toan, roi ngung theo doi camId do.
ipcMain.on('camrec:stop-cam', (e, camId) => {
  if (camId) finalizeTake(camId);
});

ipcMain.on('camrec:open-folder', (e, camId) => {
  const dir = camId ? path.join(CAM_REC_ROOT, camId) : CAM_REC_ROOT;
  ensureDir(dir);
  shell.openPath(dir);
});

// ====== Danh sach quan ly ban ghi ngay trong app (xem/mo/xoa) ======
function listCamRecordings() {
  const results = [];
  try {
    ensureDir(CAM_REC_ROOT);
    for (const camId of fs.readdirSync(CAM_REC_ROOT)) {
      const camDir = path.join(CAM_REC_ROOT, camId);
      if (!fs.statSync(camDir).isDirectory()) continue;
      for (const takeId of fs.readdirSync(camDir)) {
        const dir = path.join(camDir, takeId);
        if (!fs.statSync(dir).isDirectory()) continue;
        let totalSize = 0;
        let mtime = 0;
        let files = [];
        try {
          files = fs.readdirSync(dir).filter(f => f.startsWith('video'));
          for (const f of files) {
            const st = fs.statSync(path.join(dir, f));
            totalSize += st.size;
            if (st.mtimeMs > mtime) mtime = st.mtimeMs;
          }
        } catch (e) {}
        const isActive = activeTakes.has(camId) && activeTakes.get(camId).takeId === takeId;
        const mainFile = files.length ? path.join(dir, files[0]) : null;
        results.push({ camId, takeId, dir, files, mainFile, sizeBytes: totalSize, mtime, isActive });
      }
    }
  } catch (e) {}
  results.sort((a, b) => b.mtime - a.mtime);
  return results;
}
ipcMain.handle('camrec:list', () => listCamRecordings());

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
ipcMain.on('camrec:delete', (e, { camId, takeId }) => {
  if (!camId || !takeId) return;
  const active = activeTakes.get(camId);
  if (active && active.takeId === takeId) finalizeTake(camId); // dang ghi do -> chot lai truoc roi moi xoa
  try { fs.rmSync(takeDir(camId, takeId), { recursive: true, force: true }); } catch (e) {}
});
ipcMain.on('camrec:open-file', (e, filePath) => {
  if (filePath) shell.openPath(filePath);
});

// ====== Tu dong xoa ban ghi cu theo thoi gian nguoi dung chon (0 = khong bao gio) ======
let camRetentionDays = 0;
function runCamRetentionCleanup() {
  if (!camRetentionDays) return;
  const cutoff = Date.now() - camRetentionDays * 24 * 60 * 60 * 1000;
  for (const rec of listCamRecordings()) {
    if (rec.isActive) continue; // dang ghi do thi khong bao gio tu xoa
    if (rec.mtime && rec.mtime < cutoff) {
      try { fs.rmSync(rec.dir, { recursive: true, force: true }); } catch (e) {}
    }
  }
}
ipcMain.on('camrec:set-retention', (e, days) => {
  camRetentionDays = Number(days) || 0;
  runCamRetentionCleanup();
});
setInterval(runCamRetentionCleanup, 60 * 60 * 1000); // kiem tra lai moi gio, phong khi app mo nhieu ngay lien

// Tat han "ca trinh duyet" -> chot lai (dong file an toan) moi lan ghi dang
// do truoc khi thoat, dung yeu cau "chi huy ket noi khi doi ma QR hoac tat
// han trinh duyet".
app.on('before-quit', () => {
  for (const camId of [...activeTakes.keys()]) finalizeTake(camId);
});

function createWindow(initialUrl) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const query = initialUrl ? { initialUrl } : undefined;
  win.loadFile('index.html', query ? { query } : undefined);

  attachDownloadListenerOnce();
  attachRequestFilterOnce();

  // Cho phep cua so popup THAT (vd: window.open co kich thuoc rieng de xem
  // anh POD) duoc mo va hien thi binh thuong. Con lai - click link co
  // target="_blank", giua-click chuot, ctrl/cmd+click - Chromium coi la yeu
  // cau mo "tab" (disposition 'foreground-tab' / 'background-tab') chu
  // khong phai popup that, nen ta CHAN khong cho bat cua so Electron moi ma
  // bao renderer (index.html) tu mo 1 TAB MOI trong chinh app, giong hanh vi
  // trinh duyet Chrome.
  win.webContents.on('did-attach-webview', (event, webContents) => {
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

  // ====== Menu chuot phai (giong Chrome) khi bam vao link/vung chu ben trong webview ======
  ipcMain.on('context-menu:show', (e, params) => {
    if (e.sender !== win.webContents) return;
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
    if (e.sender === win.webContents) win.minimize();
  });
  ipcMain.on('win:toggleMaximize', (e) => {
    if (e.sender !== win.webContents) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('win:close', (e) => {
    if (e.sender === win.webContents) win.close();
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
