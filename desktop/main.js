const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');

// Ẩn hoàn toàn thanh menu File/Edit/View/Window/Help trên mọi cửa sổ
Menu.setApplicationMenu(null);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true, // phòng trường hợp menu bật lại, vẫn tự ẩn
    frame: false, // bo thanh tieu de mac dinh cua he dieu hanh -> tu ve
                   // thanh tieu de bang HTML de gop chung 1 hang voi cac tab
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
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

  // Bao cho renderer biet trang thai maximize hien tai de doi icon nut phong to <-> khoi phuc
  win.on('maximize', () => win.webContents.send('win:maximized-state', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized-state', false));
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
