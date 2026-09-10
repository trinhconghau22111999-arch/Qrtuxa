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

  // ====== Ho tro tay cam keo-gian vien cua so tu ve trong renderer ======
  // (can vi cua so frame:false + noi dung phu kin sat mep khien HDH khong
  // con nhan dien duoc thao tac keo-gian mac dinh o vien nua - xem index.html)
  ipcMain.handle('win:get-bounds', (e) => {
    if (e.sender !== win.webContents) return null;
    return win.getBounds();
  });
  ipcMain.on('win:set-bounds', (e, bounds) => {
    if (e.sender !== win.webContents || !bounds) return;
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
  const activeRecordingFiles = new Map(); // recordingId -> { fd, filePath }
  let recordingIdCounter = 0;

  ipcMain.handle('recording:choose-folder', async (e) => {
    if (e.sender !== win.webContents) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Chọn nơi lưu video ghi hình',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('recording:start-file', (e, { folder, filename }) => {
    if (e.sender !== win.webContents) return { ok: false, error: 'invalid sender' };
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
    if (e.sender !== win.webContents) return { ok: false, error: 'invalid sender' };
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
    if (e.sender !== win.webContents) return { ok: false, error: 'invalid sender' };
    const entry = activeRecordingFiles.get(recordingId);
    if (!entry) return { ok: false, error: 'recording not found' };
    try { fs.closeSync(entry.fd); } catch (err) {}
    activeRecordingFiles.delete(recordingId);
    return { ok: true, path: entry.filePath };
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
