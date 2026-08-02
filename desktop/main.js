const { app, BrowserWindow, Menu, ipcMain, clipboard, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// An hoan toan thanh menu File/Edit/View/Window/Help tren moi cua so
Menu.setApplicationMenu(null);

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

// ====== Chan quang cao (danh sach domain quang cao/theo doi pho bien, nhung
// san trong app - khong phai tai EasyList day du theo thoi gian thuc) ======
const AD_BLOCK_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'adservice.google.com', 'pagead2.googlesyndication.com',
  'facebook.com/tr', 'connect.facebook.net',
  'amazon-adsystem.com', 'taboola.com', 'outbrain.com', 'criteo.com',
  'criteo.net', 'adnxs.com', 'moatads.com', 'scorecardresearch.com',
  'quantserve.com', 'adform.net', 'pubmatic.com', 'rubiconproject.com',
  'media.net', 'popads.net', 'propellerads.com', 'exoclick.com',
  'adcolony.com', 'applovin.com', 'mgid.com', 'revcontent.com',
  'yandex.ru/ads', 'bidswitch.net', 'casalemedia.com', 'openx.net',
  'smartadserver.com', 'adroll.com', 'zedo.com', 'adsrvr.org',
  '3lift.com', 'contextweb.com', 'sharethrough.com',
  // Mang quang cao pho bien tai Viet Nam
  'admicro.vn', 'adtima.vn', 'eclick.vn', 'ants.vn', 'admax.vn'
];
let adBlockEnabled = true;
let adBlockedCount = 0;
let adBlockBroadcastTimer = null;

function isAdHost(hostAndPath) {
  return AD_BLOCK_DOMAINS.some(d => hostAndPath.includes(d));
}

function broadcastAdblockState() {
  clearTimeout(adBlockBroadcastTimer);
  adBlockBroadcastTimer = setTimeout(() => {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('adblock:update', { enabled: adBlockEnabled, count: adBlockedCount })
    );
  }, 400); // gop nhieu lan chan lai, tranh spam IPC khi 1 trang co qua nhieu quang cao
}

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

ipcMain.handle('adblock:get-state', () => ({ enabled: adBlockEnabled, count: adBlockedCount }));
ipcMain.on('adblock:toggle', (e, enabled) => {
  adBlockEnabled = !!enabled;
  broadcastAdblockState();
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

    // Chan quang cao/theo doi theo domain
    if (adBlockEnabled && isAdHost(details.url)) {
      adBlockedCount++;
      broadcastAdblockState();
      callback({ cancel: true });
      return;
    }

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
// camId -> { takeId, dir, filePath, fd, chunkCount, startedAt, lastTs }
const activeTakes = new Map();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function takeDir(camId, takeId) {
  return path.join(CAM_REC_ROOT, camId, takeId);
}

// Cac doan video (chunk) do MediaRecorder ben dien thoai cat ra, khi noi
// TRUC TIEP theo dung thu tu vao 1 file duy nhat se tao thanh 1 file video
// lien tuc, xem duoc binh thuong (day la ky thuat pho bien de ghi video
// truc tiep xuong dia tu 1 phien MediaRecorder duy nhat) - KHONG can ffmpeg
// hay bat ky buoc ghep noi phuc tap nao khac.
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
        camId, takeId: entry.takeId, ext: entry.ext,
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
  const filePath = path.join(dir, 'video.' + safeExt);
  const fd = fs.openSync(filePath, 'w');
  activeTakes.set(camId, {
    takeId, dir, filePath, fd, ext: safeExt,
    chunkCount: 0, startedAt: Date.now(), lastTs: Date.now()
  });
});

ipcMain.on('camrec:chunk', (e, { camId, takeId, ts, dataBase64 }) => {
  if (!camId || !takeId || !dataBase64) return;
  let entry = activeTakes.get(camId);
  if (!entry || entry.takeId !== takeId) {
    // Chua thay currentTake truoc do (vd. race luc moi ket noi) -> tu tao file luon (mac dinh webm).
    const dir = takeDir(camId, takeId);
    ensureDir(dir);
    const filePath = path.join(dir, 'video.webm');
    const fd = fs.openSync(filePath, 'w');
    entry = { takeId, dir, filePath, fd, ext: 'webm', chunkCount: 0, startedAt: Date.now(), lastTs: Date.now() };
    activeTakes.set(camId, entry);
  }
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
