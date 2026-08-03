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
  }
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
  detachToNewWindow: (url) => ipcRenderer.send('tab:detach', url)
});

// Cau noi cho tinh nang Tai xuong (main.js theo doi session tai file va bao
// trang thai/tien trinh ve day theo thoi gian thuc).
contextBridge.exposeInMainWorld('downloadsBridge', {
  onUpdate: (callback) => {
    ipcRenderer.on('downloads:update', (event, list) => callback(list));
  },
  showInFolder: (filePath) => ipcRenderer.send('downloads:show-in-folder', filePath),
  openFile: (filePath) => ipcRenderer.send('downloads:open-file', filePath),
  cancel: (id) => ipcRenderer.send('downloads:cancel', id),
  clearFinished: () => ipcRenderer.send('downloads:clear-finished')
});

// Chan quang cao: bat/tat + nhan so luong da chan (gop nhieu lan chan lai o main.js).
contextBridge.exposeInMainWorld('adblockBridge', {
  getState: () => ipcRenderer.invoke('adblock:get-state'),
  toggle: (enabled) => ipcRenderer.send('adblock:toggle', enabled),
  onUpdate: (callback) => {
    ipcRenderer.on('adblock:update', (event, state) => callback(state));
  }
});

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

// QR Cam: renderer chi lo viec lang nghe Firebase va nhan khung hinh, con
// LUU FILE THAT xuong dia thi giao het cho main.js qua day (renderer khong
// co quyen ghi file truc tiep vi contextIsolation dang bat).
contextBridge.exposeInMainWorld('camBridge', {
  newTake: (camId, takeId, ext) => ipcRenderer.send('camrec:new-take', { camId, takeId, ext }),
  sendChunk: (camId, takeId, ts, dataBase64) => ipcRenderer.send('camrec:chunk', { camId, takeId, ts, dataBase64 }),
  stopCam: (camId) => ipcRenderer.send('camrec:stop-cam', camId),
  openFolder: (camId) => ipcRenderer.send('camrec:open-folder', camId),
  list: () => ipcRenderer.invoke('camrec:list'),
  delete: (camId, takeId) => ipcRenderer.send('camrec:delete', { camId, takeId }),
  openFile: (filePath) => ipcRenderer.send('camrec:open-file', filePath),
  setRetentionDays: (days) => ipcRenderer.send('camrec:set-retention', days)
});
