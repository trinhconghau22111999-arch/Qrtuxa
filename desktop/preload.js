const { contextBridge, ipcRenderer } = require('electron');

// Vi contextIsolation:true nen renderer (index.html) khong the goi thang
// require('electron'). Preload nay chi lo ra dung 3 lenh dieu khien cua so
// (thu nho / phong to-khoi phuc / dong) va 1 kenh nhan trang thai maximize,
// khong dung gi den logic quet QR hay bookmark ca.
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
  close: () => ipcRenderer.send('win:close'),
  onMaximizedChange: (callback) => {
    ipcRenderer.on('win:maximized-state', (event, isMaximized) => callback(isMaximized));
  }
});

// Cau noi rieng cho tinh nang "mo lien ket trong tab moi" (giua-click / target=_blank
// va menu chuot phai kieu Chrome). Chi lo ra dung 3 ham can thiet, khong dung gi
// den require('electron') thang trong renderer vi contextIsolation dang bat.
contextBridge.exposeInMainWorld('tabBridge', {
  onOpenNewTab: (callback) => {
    ipcRenderer.on('open-new-tab', (event, url) => callback(url));
  },
  showContextMenu: (params) => ipcRenderer.send('context-menu:show', params),
  onContextMenuAction: (callback) => {
    ipcRenderer.on('context-menu:action', (event, action) => callback(action));
  }
});
