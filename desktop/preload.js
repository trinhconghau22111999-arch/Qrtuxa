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
