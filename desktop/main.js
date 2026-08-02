const { app, BrowserWindow, Menu, ipcMain, clipboard, session, shell } = require('electron');
const path = require('path');

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
