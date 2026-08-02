const { app, BrowserWindow, Menu, ipcMain, clipboard } = require('electron');
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
      // foreground-tab / background-tab -> mo tab moi trong app, khong mo cua so moi
      if (details.url) win.webContents.send('open-new-tab', details.url);
      return { action: 'deny' };
    });
  });

  // ====== Menu chuot phai (giong Chrome) khi bam vao link/vung chu ben trong webview ======
  // <webview> phat su kien 'context-menu' voi params (linkURL, selectionText...).
  // Renderer chuyen tiep params nay len day qua kenh 'context-menu:show', ta dung
  // Menu native cua he dieu hanh de hien thi cho dung cam giac trinh duyet that,
  // roi bao lai renderer hanh dong nguoi dung da chon (mo tab moi, sao chep, ...).
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
