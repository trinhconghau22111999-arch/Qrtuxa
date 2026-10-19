const { app, BrowserWindow, Menu, ipcMain, clipboard, session, shell, dialog, safeStorage } = require('electron');
// Chế độ LAN: để WebRTC lộ địa chỉ IP thật của mạng nội bộ (thay vì tên ẩn xxxx.local)
// giúp điện thoại Android tìm đúng đường tới máy tính trong cùng Wi-Fi.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
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
// File log gon nhe ghi lai console.log/warn/error tu CHINH trang web dang
// xem, KHONG can mo DevTools that su - vi 1 so trang tu phat hien DevTools
// dang mo (do lech kich thuoc cua so) roi chan video, ghi log kieu nay
// (dung su kien noi bo 'console-message' cua Electron, khong bat DevTools
// that) tranh duoc bay do hoan toan.
const CONSOLE_LOG_FILE = path.join(APP_DATA_DIR, 'console-log.txt');
function appendConsoleLog(line) {
  try {
    if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.appendFileSync(CONSOLE_LOG_FILE, line + '\n', 'utf8');
    const stat = fs.statSync(CONSOLE_LOG_FILE);
    // Gioi han file khong qua 2MB, tranh phinh to sau nhieu phien dung -
    // giu lai phan MOI NHAT (1MB cuoi) khi vuot nguong.
    if (stat.size > 2 * 1024 * 1024) {
      const content = fs.readFileSync(CONSOLE_LOG_FILE, 'utf8');
      fs.writeFileSync(CONSOLE_LOG_FILE, content.slice(-1024 * 1024), 'utf8');
    }
  } catch (err) { /* log la tinh nang phu, loi thi bo qua, khong lam sap app */ }
}
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
// Preload của trang khách hỏi ĐỒNG BỘ mức zoom đã lưu cho origin của nó ngay lúc
// trang bắt đầu dựng (trước cả khi vẽ khung hình đầu), để trang hiện đúng cỡ
// luôn thay vì hiện 100% rồi mới giật sang cỡ đã lưu.
ipcMain.on('zoom:get-sync', (e, origin) => {
  let z = 1;
  try {
    const map = readLocalStoreValue('zoom-by-origin');
    const v = map && origin ? Number(map[origin]) : 1;
    if (v && isFinite(v)) z = Math.min(3, Math.max(0.5, v));
  } catch (err) {}
  e.returnValue = z;
});
ipcMain.on('localstore:set', (e, { key, value }) => {
  try {
    ensureDirSafe(APP_DATA_DIR);
    writeLocalStoreValue(key, value);
  } catch (err) { /* 1 lan ghi loi khong lam sap app, bo qua */ }
});
// ====== Lich su quet: luu moi gia tri dien thoai quet va da go vao o nhap, roi
// xuat ra file Excel (.xlsx) - 1 cot doc, moi dong 1 gia tri - va mo luon.
// Tu viet bo ghi xlsx toi thieu (zip + XML) bang zlib co san, khong can them thu vien. ======
const SCAN_HISTORY_KEY = 'scan-history';
const SCAN_HISTORY_MAX = 50000;
function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
// Chi giu du lieu CUA HOM NAY: sang ngay moi thi du lieu ngay truoc bi xoa (file Excel
// da tai ve thu muc Tai xuong thi van con). Xoa khi: them du lieu, xuat Excel, mo app.
function pruneScanHistoryToToday() {
  try {
    ensureDirSafe(APP_DATA_DIR);
    const all = loadScanHistory();
    const sod = startOfToday();
    const kept = all.filter(x => x.t >= sod);
    if (kept.length !== all.length) writeLocalStoreValue(SCAN_HISTORY_KEY, kept);
    return kept;
  } catch (err) { return []; }
}
// Moi muc luu dang {t: thoi-diem(ms), v: noi dung}. Ban cu chi luu chuoi tran
// (khong co gio) -> doi sang {t, v} voi t = lan ghi cuoi cua file (gan nhat co the).
function loadScanHistory() {
  let list = readLocalStoreValue(SCAN_HISTORY_KEY);
  if (!Array.isArray(list)) return [];
  let legacyT = Date.now();
  try { legacyT = fs.statSync(localStoreFile(SCAN_HISTORY_KEY)).mtimeMs; } catch (e) {}
  return list.map(x => (x && typeof x === 'object' && 'v' in x) ? x : { t: legacyT, v: String(x) });
}
ipcMain.on('scanhistory:add', (e, text) => {
  try {
    const v = String(text == null ? '' : text).trim();
    if (!v) return;
    ensureDirSafe(APP_DATA_DIR);
    const now = Date.now();
    let list = pruneScanHistoryToToday();
    list.push({ t: now, v });
    if (list.length > SCAN_HISTORY_MAX) list = list.slice(-SCAN_HISTORY_MAX);
    writeLocalStoreValue(SCAN_HISTORY_KEY, list);
  } catch (err) { /* ghi lich su loi thi bo qua, khong anh huong viec nhap */ }
});
ipcMain.handle('scanhistory:count', () => {
  try { return loadScanHistory().length; } catch (err) { return 0; }
});
ipcMain.handle('scanhistory:clear', () => {
  try { ensureDirSafe(APP_DATA_DIR); writeLocalStoreValue(SCAN_HISTORY_KEY, []); return true; } catch (err) { return false; }
});

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipFiles(files) { // files: [{name, data(Buffer)}]
  const zlib = require('zlib');
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
function xmlEsc(v) {
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function buildXlsx(rows) { // rows: [{v, t}] -> A: noi dung (chu), B: gio (kieu gio that), C: ngay (kieu ngay that)
  // Gio va ngay ghi dang SO that cua Excel kem dinh dang hh:mm:ss / dd/mm/yyyy
  // de loc/sap xep theo ngay gio duoc. Dong 1 la tieu de + bo loc (AutoFilter).
  const cellStr = (ref, text, style) => `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
  const body = rows.map((x, i) => {
    const d = new Date(x.t);
    const r = i + 2;
    const dateSerial = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) + 25569;
    const timeFrac = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + 0.001) / 86400; // +1ms de khong bi lam tron xuong giay truoc
    return `<row r="${r}">${cellStr('A' + r, x.v)}<c r="B${r}" s="1"><v>${timeFrac.toFixed(12)}</v></c><c r="C${r}" s="2"><v>${dateSerial}</v></c></row>`;
  }).join('');
  const header = `<row r="1">${cellStr('A1', 'Dữ liệu quét', 3)}${cellStr('B1', 'Giờ', 3)}${cellStr('C1', 'Ngày', 3)}</row>`;
  const last = rows.length + 1;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="2"><numFmt numFmtId="164" formatCode="hh:mm:ss"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Lich su quet" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
    { name: 'xl/styles.xml', data: Buffer.from(styles, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="32" customWidth="1"/><col min="2" max="3" width="14" customWidth="1"/></cols><sheetData>' + header + body + `</sheetData><autoFilter ref="A1:C${last}"/></worksheet>`, 'utf8') }
  ];
  return zipFiles(files);
}
ipcMain.handle('scanhistory:export', async () => {
  try {
    ensureDirSafe(APP_DATA_DIR);
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dayKey = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const today = pruneScanHistoryToToday();
    if (!today.length) return { ok: false, empty: true };
    const dir = app.getPath('downloads');
    ensureDirSafe(dir);
    // Moi ngay 1 file: Lich-su-quet-YYYYMMDD.xlsx (bam lai trong ngay thi ghi de cung file).
    // Neu file dang mo trong Excel (khong ghi de duoc) thi tao file them gio-phut-giay.
    let file = path.join(dir, `Lich-su-quet-${dayKey}.xlsx`);
    const data = buildXlsx(today);
    try {
      fs.writeFileSync(file, data);
    } catch (err) {
      file = path.join(dir, `Lich-su-quet-${dayKey}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.xlsx`);
      fs.writeFileSync(file, data);
    }
    const err = await shell.openPath(file);
    return { ok: !err, filePath: file, count: today.length, error: err || undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

function ensureDirSafe(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Xoa cache HTTP cua cac trang web dang duyet (webview dung chung partition
// 'persist:browse', xem DOWNLOAD_PARTITION ben duoi). CHI xoa cache mang
// (Cache-Control/disk cache) - KHONG dong cham cookie/localStorage/
// indexedDB/service worker cua trang, nen tai khoan dang dang nhap tren cac
// trang web (Facebook, Gmail...) VAN GIU NGUYEN, khong bi dang xuat. Du lieu
// rieng cua app (dau trang/lich su/mat khau da luu) nam trong APP_DATA_DIR,
// khong lien quan gi toi ham nay nen cung khong bi mat.
ipcMain.handle('cache:clear', async () => {
  try {
    const ses = session.fromPartition(DOWNLOAD_PARTITION);
    await ses.clearCache();
    await ses.clearStorageData({ storages: ['cachestorage'] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Mo file log console (bang app mac dinh, vd Notepad) va xoa trang lam moi
// truoc khi bat dau ghi lai 1 phien loi - xem CONSOLE_LOG_FILE phia tren.
ipcMain.handle('debuglog:open', async () => {
  try {
    if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    if (!fs.existsSync(CONSOLE_LOG_FILE)) fs.writeFileSync(CONSOLE_LOG_FILE, '', 'utf8');
    const err = await shell.openPath(CONSOLE_LOG_FILE);
    return { ok: !err, error: err || null };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('debuglog:clear', async () => {
  try {
    if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.writeFileSync(CONSOLE_LOG_FILE, '', 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ====== Theo doi Tai xuong (dung chung cho moi cua so vi cac webview deu
// dung chung 1 partition 'persist:browse') ======
const DOWNLOAD_PARTITION = 'persist:browse';
const downloads = new Map(); // id -> { id, filename, path, url, state, receivedBytes, totalBytes }
let downloadCounter = 0;
let downloadListenerAttached = false;

function broadcastDownloads() {
  // Bỏ trường _item (đối tượng DownloadItem gốc) trước khi gửi qua IPC.
  const list = [...downloads.values()].sort((a, b) => b.id - a.id)
    .map(({ _item, ...rest }) => rest);
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

    // Khong con chan quang cao theo domain o tang mang: YouTube phat hien
    // request quang cao bi chan roi hien canh bao. Gio de quang cao tai binh
    // thuong, trang YouTube tu bam "Bo qua" / tua nhanh qua script o renderer.

    callback({ cancel: false });
  });

  // Ghi log rieng cho cac request MANG that su bi loi (status >= 400) hoac
  // co ve lien quan xac thuc/khoa video (key/token/auth/license/drm trong
  // URL) - de bat dung request nao bi tu choi (vd xin "key" giai ma video
  // bi 403) MA KHONG CAN MO DEVTOOLS (tranh bay chong-DevTools cua trang -
  // xem CONSOLE_LOG_FILE). Chi log request dang nghi van, KHONG log tat ca
  // moi request (se qua nhieu, khong doc noi).
  const AUTH_LIKE_URL_RE = /key|token|auth|license|drm|verify|sign/i;
  ses.webRequest.onCompleted((details) => {
    const looksAuthRelated = AUTH_LIKE_URL_RE.test(details.url);
    const isError = details.statusCode >= 400;
    if (!looksAuthRelated && !isError) return;
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    appendConsoleLog(
      `[${time}] [NETWORK] ${details.method} ${details.statusCode} ${details.url}`
    );
  });
  // QUAN TRONG: onCompleted o tren CHI bat duoc request DA HOAN TAT (ke ca
  // loi 403/404). Request bi CHAN/GAY GIUA CHUNG truoc khi hoan tat - vd bi
  // CORS chan, bi tu choi ket noi, DNS loi... - se KHONG bao gio kich hoat
  // onCompleted, ma kich hoat 'onErrorOccurred' rieng. Day thuong moi la
  // nguyen nhan that su cua loi "jwplayer Authentication failed" (request
  // xin khoa video bi chan hoan toan, khong he co status code tra ve).
  const AD_LIKE_URL_RE = /doubleclick|pagead|\/ptracking|api\/stats\/ads|googleadservices|googlesyndication|\/get_midroll/i;
  ses.webRequest.onErrorOccurred((details) => {
    const adLike = AD_LIKE_URL_RE.test(details.url);
    if (!adLike && !AUTH_LIKE_URL_RE.test(details.url) && details.resourceType !== 'xhr'
      && details.resourceType !== 'fetch' && details.resourceType !== 'media') return;
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    appendConsoleLog(
      `[${time}] [${adLike ? 'AD-REQUEST-ERROR' : 'NETWORK-ERROR'}] ${details.method} ${details.error} ${details.url}`
    );
  });
}

// ====== Gia User-Agent giong trinh duyet Chrome that, bo dau vet Electron
// (nguoi dung phan anh: nhieu trang video/nguon phim VA ca tai file tu Google
// Drive deu bi tu choi phuc vu - "quay vong vong khong tai duoc") ======
// Mac dinh Electron TU GAN THEM 2 doan vao cuoi chuoi User-Agent chuan cua
// Chromium: " TenApp/PhienBan" (lay tu package.json - o day la
// "qr-remote-input-browser/1.0.0") va " Electron/PhienBanElectron". Nhieu
// dich vu (Google Drive/Docs, mot so CDN video chong bot...) do chuoi nay,
// thay khac voi trinh duyet that -> tu choi phuc vu hoac bat xac thuc them
// ma khong bao gio hoan tat, giao dien client chi thay nhu "dang tai mai
// khong xong". Cach xu ly CHUAN (khong phai gia mao trinh duyet khac, chi
// dung LAI dung phien ban Chromium ma Electron nay dang dung san, bo di 2
// doan rieng cua Electron): lay UA goc cua chinh session nay roi cat bo 2
// doan do, KHONG hardcode 1 chuoi UA co dinh de tranh lech phien ban thuc te
// (vd khi nang cap Electron len sau nay).
function stripElectronFromUserAgent(rawUA) {
  let ua = rawUA;
  // Bo " Electron/x.y.z"
  ua = ua.replace(/\s*Electron\/\S+/i, '');
  // Bo " TenApp/PhienBan" - ten/phien ban lay dung tu package.json cua CHINH
  // app nay (co the doi ten/phien ban sau nay, nen lay dong chu khong hardcode).
  const appToken = `${app.getName()}/${app.getVersion()}`;
  const escaped = appToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  ua = ua.replace(new RegExp('\\s*' + escaped, 'i'), '');
  return ua.replace(/\s{2,}/g, ' ').trim();
}
let userAgentOverrideAttached = false;
function attachUserAgentOverrideOnce() {
  if (userAgentOverrideAttached) return;
  userAgentOverrideAttached = true;
  const ses = session.fromPartition(DOWNLOAD_PARTITION);
  const cleanUA = stripElectronFromUserAgent(ses.getUserAgent());
  ses.setUserAgent(cleanUA);
}

// ====== Ep 4 trang Telegram/Zalo/Facebook/YouTube (nut chia doi man hinh o
// toolbar) hien THEO GIAO DIEN TIENG VIET ======
// Nhieu trang doc ngon ngu uu tien tu header HTTP "Accept-Language" cua trinh
// duyet (Telegram Web, Zalo Web la 2 vi du - khong co tham so URL nao doi
// ngon ngu duoc ca), nen cach chac chan nhat la ep header nay thanh tieng
// Viet CHI RIENG cho 4 domain nay (dung "urls" filter, KHONG anh huong cac
// trang khac nguoi dung dang xem trong cac tab thuong).
const VIETNAMESE_LANG_URL_PATTERNS = [
  '*://web.telegram.org/*',
  '*://*.telegram.org/*',
  '*://chat.zalo.me/*',
  '*://*.zalo.me/*',
  '*://*.facebook.com/*',
  '*://*.youtube.com/*'
];
let vietnameseLangHeaderAttached = false;
function attachVietnameseLangHeaderOnce() {
  if (vietnameseLangHeaderAttached) return;
  vietnameseLangHeaderAttached = true;
  const ses = session.fromPartition(DOWNLOAD_PARTITION);
  ses.webRequest.onBeforeSendHeaders({ urls: VIETNAMESE_LANG_URL_PATTERNS }, (details, callback) => {
    details.requestHeaders['Accept-Language'] = 'vi-VN,vi;q=0.9';
    callback({ requestHeaders: details.requestHeaders });
  });
}

// Chup anh trang web: renderer da tu chup xong (webview.capturePage() ->
// dataURL), o day chi lo hien hop thoai "Luu thanh..." de nguoi dung chon
// noi luu, roi ghi file PNG that xuong dung cho do (renderer khong co quyen
// ghi file truc tiep vi contextIsolation dang bat).
// Bam 2 lan nut chup anh: gui CHINH to hop phim Windows + Shift + S (cong cu cat
// man hinh cua Windows). Dung keybd_event qua PowerShell; neu loi thi mo
// ms-screenclip: (cung cong cu do).
ipcMain.handle('screenshot:snip', async () => {
  if (process.platform !== 'win32') return false;
  const { execFile } = require('child_process');
  const ps = "Add-Type -Namespace W -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, int f, int e);';" +
    "[W.K]::keybd_event(0x5B,0,0,0);[W.K]::keybd_event(0x10,0,0,0);[W.K]::keybd_event(0x53,0,0,0);" +
    "[W.K]::keybd_event(0x53,0,2,0);[W.K]::keybd_event(0x10,0,2,0);[W.K]::keybd_event(0x5B,0,2,0);";
  return await new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true }, (err) => {
      if (err) { try { shell.openExternal('ms-screenclip:'); } catch (e) {} resolve(false); }
      else resolve(true);
    });
  });
});

// ====== Nhap van ban bang giong noi ======
// Electron khong dung duoc Web Speech API (can khoa Google rieng nen luon loi
// "network"), nen dung chinh tinh nang go bang giong noi CO SAN cua Windows:
// to hop phim Windows + H (bat/tat). Windows tu nghe mic va go chu vao o dang
// chon (ke ca o nhap trong trang web). Gui to hop phim bang PowerShell giong
// cach nut chup anh gui Windows + Shift + S.
ipcMain.handle('voice:toggle', async () => {
  if (process.platform !== 'win32') return { ok: false, unsupported: true };
  const { execFile } = require('child_process');
  const ps = "Add-Type -Namespace W -Name K2 -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, int f, int e);';" +
    "[W.K2]::keybd_event(0x5B,0,0,0);[W.K2]::keybd_event(0x48,0,0,0);" +
    "[W.K2]::keybd_event(0x48,0,2,0);[W.K2]::keybd_event(0x5B,0,2,0);";
  return await new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true }, (err) => {
      resolve(err ? { ok: false, error: String(err.message || err) } : { ok: true });
    });
  });
});

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

// ====== Cac lenh IPC dieu khien cua so / quay video / luu anh - DUNG CHUNG
// cho MOI cua so (ke ca cua so tach tu 1 tab ra) ======
// LOI NGHIEM TRONG DA SUA (nguoi dung phan anh: "video/trang web quay vong
// vong khong tai duoc", kem anh chup loi that "A JavaScript error occurred
// in the main process... Attempted to register a second handler for
// 'win:get-bounds'" va "TypeError: Object has been destroyed"):
// TRUOC DAY toan bo cac ipcMain.on/ipcMain.handle ben duoi nam BEN TRONG ham
// createWindow(), dong lai bien `win` cua CHINH LAN GOI DO qua closure. Ham
// createWindow() lai duoc goi THEM MOI LAN nguoi dung keo 1 tab tach thanh
// cua so rieng (xem ipcMain.on('tab:detach',...) o cuoi file) - nghia la moi
// lan tach tab, TOAN BO cac dong ipcMain.handle(...) ben duoi bi chay dang
// ky LAN THU HAI. Electron CHI cho phep 1 handler duy nhat cho moi ten kenh
// ('win:get-bounds' la kenh dau tien gap phai) - dang ky lan 2 nem loi NGAY
// LAP TUC, lam dut quang giua chung viec khoi tao cua so moi (cac dong dang
// ky con lai phia sau khong con chay duoc nua) va dan den loi "Object has
// been destroyed" ve sau khi trang goi lai nhung lenh chua kip dang ky xong/
// dang ky vao cua so da bi dong. Sua tan goc: dua HET cac dang ky nay ra
// NGOAI createWindow(), CHI dang ky DUY NHAT 1 LAN cho toan bo app (giong
// cac ham *Once() khac trong file nay), va MOI handler tu tim dung cua so
// cua chinh no qua BrowserWindow.fromWebContents(e.sender) thay vi khoa
// cung vao 1 bien `win` co dinh - hoat dong dung cho MOI cua so, du la cua
// so chinh hay cua so tach tu tab.
//
let windowControlsIpcAttached = false;
function attachWindowControlsIpcOnce() {
  if (windowControlsIpcAttached) return;
  windowControlsIpcAttached = true;

  // ====== Menu chuot phai (giong Chrome) khi bam vao link/vung chu ben trong webview ======
  ipcMain.on('context-menu:show', (e, params) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
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
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.minimize();
  });
  ipcMain.on('win:toggleMaximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('win:close', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.close();
  });

  // ====== Ho tro tay cam keo-gian vien cua so tu ve trong renderer ======
  // (can vi cua so frame:false + noi dung phu kin sat mep khien HDH khong
  // con nhan dien duoc thao tac keo-gian mac dinh o vien nua - xem index.html)
  ipcMain.handle('win:get-bounds', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win ? win.getBounds() : null;
  });
  ipcMain.on('win:set-bounds', (e, bounds) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || !bounds) return;
    const MIN_W = 480, MIN_H = 360;
    win.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(MIN_W, Math.round(bounds.width)),
      height: Math.max(MIN_H, Math.round(bounds.height))
    });
  });
}

function createWindow(initialUrl, initialState) {
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
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const query = initialUrl ? { initialUrl } : undefined;
  // Trạng thái trang lúc tách tab (vị trí cuộn, thời điểm video/nhạc) - JSON qua query.
  if (query && initialState) query.initialState = JSON.stringify(initialState);
  win.loadFile('index.html', query ? { query } : undefined);

  attachDownloadListenerOnce();
  attachRequestFilterOnce();
  attachVietnameseLangHeaderOnce();
  attachWindowControlsIpcOnce();
  attachUserAgentOverrideOnce();

  // Cho phep cua so popup THAT (vd: window.open co kich thuoc rieng de xem
  // anh POD) duoc mo va hien thi binh thuong. Con lai - click link co
  // target="_blank", giua-click chuot, ctrl/cmd+click - Chromium coi la yeu
  // cau mo "tab" (disposition 'foreground-tab' / 'background-tab') chu
  // khong phai popup that, nen ta CHAN khong cho bat cua so Electron moi ma
  // bao renderer (index.html) tu mo 1 TAB MOI trong chinh app, giong hanh vi
  // trinh duyet Chrome.
  win.webContents.on('did-attach-webview', (event, webContents) => {
    // Ghi log console cua trang (xem giai thich o phan khai bao CONSOLE_LOG_FILE
    // phia tren) - hoan toan tham lang, khong bat DevTools, khong bi trang phat hien.
    webContents.on('console-message', (e, level, message, line, sourceId) => {
      const levelNames = { 0: 'LOG', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };
      const levelName = levelNames[level] || ('LEVEL' + level);
      const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
      const shortSource = String(sourceId || '').split('/').pop();
      appendConsoleLog(`[${time}] [${levelName}] ${message}  (${shortSource}:${line})`);
    });
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

  win.on('maximize', () => win.webContents.send('win:maximized-state', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized-state', false));

  return win;
}

// ====== Tach 1 tab thanh cua so rieng (keo tab ra khoi thanh tab / keo qua
// cua so khac ma khong co cua so nao nhan -> mo cua so moi voi URL do) ======
ipcMain.on('tab:detach', (e, url, state) => {
  if (!url) return;
  createWindow(url, state && typeof state === 'object' ? state : undefined);
});

// ====== Tai xuong: mo thu muc chua file / mo file / huy tai / xoa muc da xong ======
ipcMain.on('downloads:show-in-folder', (e, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});
ipcMain.on('downloads:open-file', (e, filePath) => {
  if (filePath) shell.openPath(filePath);
});
// Dung luong RAM con trong - renderer dung de quyet dinh ngu tab som hon.
ipcMain.handle('sys:memory', () => {
  const free = os.freemem(), total = os.totalmem();
  return { free, total, freeRatio: total ? free / total : 1 };
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

// Mot lan duy nhat: xoa du lieu luu cua trang YouTube (localStorage, IndexedDB,
// service worker, cache) trong phien duyet. Cac ban truoc tung chan quang cao
// theo mang nen YouTube co the da ghi nho "trinh duyet nay chan quang cao" trong
// cac kho nay, khien canh bao van hien du khong con chan nua. KHONG xoa cookie
// nen khong bi dang xuat tai khoan.
async function resetYoutubeSiteDataOnce() {
  const FLAG = 'yt-reset-v1';
  try {
    ensureDirSafe(APP_DATA_DIR);
    if (readLocalStoreValue(FLAG)) return;
    const ses = session.fromPartition(DOWNLOAD_PARTITION);
    for (const origin of ['https://www.youtube.com', 'https://m.youtube.com', 'https://music.youtube.com', 'https://youtube.com']) {
      await ses.clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    }
    await ses.clearCache();
    writeLocalStoreValue(FLAG, true);
  } catch (err) { /* loi thi bo qua, lan mo sau se thu lai */ }
}

app.whenReady().then(async () => {
  pruneScanHistoryToToday();
  await resetYoutubeSiteDataOnce();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
