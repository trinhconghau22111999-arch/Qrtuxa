const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// Vi contextIsolation:true nen renderer (index.html) khong the goi thang
// require('electron'). Preload nay chi lo ra dung nhung ham can thiet.
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
  close: () => ipcRenderer.send('win:close'),
  onMaximizedChange: (callback) => {
    ipcRenderer.on('win:maximized-state', (event, isMaximized) => callback(isMaximized));
  },
  // Cho he thong tu ve tay cam keo-gian vien cua so (xem index.html) - can vi
  // du:false vi frame:false + noi dung phu kin sat mep khien HDH khong con
  // "khe ho" nao de tu nhan dien thao tac keo-gian mac dinh nua.
  getBounds: () => ipcRenderer.invoke('win:get-bounds'),
  setBounds: (bounds) => ipcRenderer.send('win:set-bounds', bounds)
});

// Duong dan tuyet doi toi preload rieng cho <webview>, dung de bat su kien
// submit form co mat khau (phuc vu tinh nang luu mat khau / tu dong dien).
contextBridge.exposeInMainWorld('appPaths', {
  guestPreload: pathToFileURL(path.join(__dirname, 'webview-preload.js')).href
});

// Cau noi cho tinh nang "mo lien ket trong tab moi" (giua-click / target=_blank
// va menu chuot phai kieu Chrome), va tach tab thanh cua so rieng.
contextBridge.exposeInMainWorld('tabBridge', {
  onOpenNewTab: (callback) => {
    ipcRenderer.on('open-new-tab', (event, url) => callback(url));
  },
  showContextMenu: (params) => ipcRenderer.send('context-menu:show', params),
  onContextMenuAction: (callback) => {
    ipcRenderer.on('context-menu:action', (event, action) => callback(action));
  },
  detachToNewWindow: (url, state) => ipcRenderer.send('tab:detach', url, state)
});

// Cau noi cho tinh nang Tai xuong (main.js theo doi session tai file va bao
// trang thai/tien trinh ve day theo thoi gian thuc).
contextBridge.exposeInMainWorld('systemBridge', {
  getMemory: () => ipcRenderer.invoke('sys:memory')
});

contextBridge.exposeInMainWorld('downloadsBridge', {
  onUpdate: (callback) => {
    ipcRenderer.on('downloads:update', (event, list) => callback(list));
  },
  showInFolder: (filePath) => ipcRenderer.send('downloads:show-in-folder', filePath),
  openFile: (filePath) => ipcRenderer.send('downloads:open-file', filePath),
  cancel: (id) => ipcRenderer.send('downloads:cancel', id),
  clearFinished: () => ipcRenderer.send('downloads:clear-finished')
});

// Chan quang cao: DA CHUYEN toan bo sang co che moi chay ngay trong renderer
// (xem YOUTUBE_AD_SKIP_JS + adBlockStore trong desktop/index.html - tu dong
// bam "Bo qua quang cao", tua nhanh, an banner/overlay ngay trong trang
// YouTube), khong con can IPC bridge sang main process nua.

// Canh bao web den/lua dao: dong bo danh sach do nguoi dung tu quan ly xuong
// main.js (noi thuc su chan request), va cho phep "van tiep tuc" 1 lan.
contextBridge.exposeInMainWorld('phishingBridge', {
  setList: (list) => ipcRenderer.send('phishing:set-list', list),
  allowOnce: (host) => ipcRenderer.send('phishing:allow-once', host)
});

// Kho luu tru CUC BO tren may (dau trang / lich su / mat khau / mau giao
// dien / danh sach chan web den) - LUU FILE THAT qua main.js, KHONG dong bo
// qua may nao/dam may nao. Day la ban thay the cho cach cu bi loi (renderer
// khong the tu goi require('fs') duoc do contextIsolation).
contextBridge.exposeInMainWorld('localStoreBridge', {
  get: (key) => ipcRenderer.invoke('localstore:get', key),
  getAll: (keys) => ipcRenderer.invoke('localstore:get-all', keys),
  set: (key, value) => ipcRenderer.send('localstore:set', { key, value })
});

// Xoa cache HTTP cua cac trang dang duyet (KHONG dong cham cookie nen tai
// khoan dang nhap tren cac trang web van giu nguyen) - xem main.js.
contextBridge.exposeInMainWorld('cacheBridge', {
  clear: () => ipcRenderer.invoke('cache:clear')
});

// Log console cua trang web dang xem, ghi lai am tham (khong bat DevTools
// that su nen khong bi cac trang tu phat hien DevTools dang mo) - xem main.js.
contextBridge.exposeInMainWorld('debugLogBridge', {
  open: () => ipcRenderer.invoke('debuglog:open'),
  clear: () => ipcRenderer.invoke('debuglog:clear')
});

// Chup anh trang web: renderer tu chup (webview.capturePage()) roi gui du
// lieu anh (dataURL) qua day cho main.js hien hop thoai "Luu thanh..." va
// ghi file that xuong dia (renderer khong co quyen ghi file truc tiep vi
// contextIsolation dang bat, giong moi thu khac trong file nay).
contextBridge.exposeInMainWorld('screenshotBridge', {
  save: (dataUrl) => ipcRenderer.invoke('screenshot:save', dataUrl),
  snip: () => ipcRenderer.invoke('screenshot:snip')
});

// Lich su quet (cac gia tri dien thoai quet va da go vao o nhap) -> xuat Excel.
contextBridge.exposeInMainWorld('scanHistoryBridge', {
  add: (text) => ipcRenderer.send('scanhistory:add', text),
  exportXlsx: () => ipcRenderer.invoke('scanhistory:export')
});
