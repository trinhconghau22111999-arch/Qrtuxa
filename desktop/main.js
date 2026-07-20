const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Ẩn hoàn toàn thanh menu File/Edit/View/Window/Help trên mọi cửa sổ
Menu.setApplicationMenu(null);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true, // phòng trường hợp menu bật lại, vẫn tự ẩn
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile('index.html');

  // Cho phep cua so popup (vd: xem anh POD) duoc mo va hien thi binh thuong,
  // thay vi bi Electron chan / tao an khien trang bao loi "Cannot read
  // properties of null (reading 'document')".
  win.webContents.on('did-attach-webview', (event, webContents) => {
    webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 900,
        height: 700,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      }
    }));
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
