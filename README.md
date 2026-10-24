# Qrtuxa — trình duyệt desktop + nhập liệu từ xa bằng QR + truyền tệp với điện thoại

Ứng dụng desktop (Electron, chạy trên Windows) có 3 phần:

1. Một **trình duyệt web đầy đủ tính năng** (thẻ tab, dấu trang, lịch sử, tải
   xuống, mật khẩu đã lưu, chặn quảng cáo, chặn web đen/lừa đảo, mở link 1
   chạm, đổi màu giao diện).
2. **QR Remote Input** — tính năng gốc của app: quét mã QR/mã vạch bằng camera
   điện thoại, nội dung quét được sẽ **gõ thẳng vào vị trí con trỏ đang chọn
   trên máy tính** — như một máy quét mã vạch không dây dùng điện thoại.
3. **Truyền tệp** — gửi/nhận tệp giữa máy tính và điện thoại (1 điện thoại, nhập
   mã 6 số) qua WebRTC DataChannel. Không còn xem/quay video.

`package.json` hiện đặt tên nội bộ là `qr-remote-input-browser` (tên gốc lúc
mới chỉ có tính năng #2) — tên hiển thị trong cửa sổ app là **"QR Remote
Browser"**; "Qrtuxa" là tên repo/thương hiệu dùng khi nhắc tới app này từ phía
điện thoại (VD dòng chữ "Nhập mã này vào Truyền tệp trên máy tính (Qrtuxa)" trong
app trên điện thoại).

## 1. Trình duyệt

Xây trên Electron với `<webview>` cho từng tab. Cửa sổ dùng khung tự vẽ
(`frame:false`) — thanh tiêu đề, nút thu nhỏ/phóng to/đóng, và việc kéo-giãn
viền cửa sổ đều tự cài đặt trong `desktop/index.html` + xử lý qua
`desktop/main.js`/`desktop/preload.js` (không dùng khung cửa sổ mặc định của
Windows).

Các tính năng trình duyệt: dấu trang, lịch sử, tải xuống, mật khẩu đã lưu, chặn
quảng cáo, chặn web đen/lừa đảo (theo danh sách domain tự quản lý), mở link
bằng 1 chạm, đổi màu giao diện — tất cả lưu cục bộ trên máy qua
`localStoreBridge` (ghi file thật xuống đĩa qua `main.js`, không dùng
`localStorage` của trình duyệt).

## 2. QR Remote Input (tính năng gốc)

Luồng hoạt động:

1. Trên máy tính, bấm tạo phiên — app sinh 1 session ID ngẫu nhiên, hiển thị
   thành mã QR (link dạng
   `https://trinhconghau22111999-arch.github.io/Qrtuxa/?session={id}`,
   trang tĩnh phục vụ từ thư mục `docs/` qua GitHub Pages).
2. Dùng điện thoại quét mã QR đó (bằng app quét mã bất kỳ) để mở trang, trang
   sẽ xin quyền camera rồi bật khung quét (`docs/index.html`, dùng thư viện
   `html5-qrcode`).
3. Ngắm camera điện thoại vào **bất kỳ mã QR hoặc mã vạch nào khác** muốn
   nhập — nội dung giải mã được gửi lên Firebase
   (`sessions/{id}/data`).
4. Máy tính nhận được nội dung đó gần như ngay lập tức và **gõ thẳng vào ô
   đang có con trỏ** trên máy tính (bất kỳ ứng dụng nào đang focus, không chỉ
   trong chính app này).

Hữu ích khi cần nhập nhanh nội dung từ mã vạch/QR vào máy tính (VD mã sản
phẩm, link, số serial...) mà không cần máy quét mã vạch chuyên dụng.

## 3. Truyền tệp

Cần app trên điện thoại hiển thị mã 6 số.

- Mở menu **3 chấm → "Truyền tệp"** (nằm ngay dưới QR Input) để vào trang Truyền tệp riêng, nhập mã 6 số vào ô
  duy nhất rồi bấm Kết nối. Mã **lưu vĩnh viễn**, tự kết nối lại khi mở app, chỉ
  mất khi bấm Ngắt hoặc nhập mã khác. Đóng trang chỉ ẩn giao diện, không ngắt kết nối.
- **Nhận tệp** từ điện thoại: lần đầu app hỏi chọn thư mục lưu (rồi nhớ lại). Tệp
  được **ghi thẳng xuống đĩa từng đoạn 64KB** ngay khi nhận (không gom vào RAM) nên
  tệp rất lớn (~1GB trở lên) vẫn nhận được. Tên trùng sẽ thêm " (1)", " (2)"...
  thay vì ghi đè. Mất kết nối giữa chừng hoặc nhận thiếu dữ liệu thì tệp dở bị xóa.
  Nhận ảnh thì mở luôn màn hình xem/sửa ảnh (cắt, xoay, vẽ, đánh dấu).
- **Gửi tệp** sang điện thoại: bấm "Chọn tệp gửi sang điện thoại" khi đã kết nối.
  Tệp được đọc từng khối 1MB bằng `file.slice()` (không đọc cả tệp vào RAM), có
  kiểm soát tốc độ gửi.
- Thanh tiến trình hiện cho cả gửi và nhận. Mỗi lần chỉ gửi 1 tệp.
- Điện thoại vẫn có thể **nhập chữ từ xa** vào ô đang có con trỏ trong trang web.

### Ghi chú

- `docs/cam.html` là bản thiết kế **cũ, không còn được dùng** (từ thời xem camera
  qua canvas) — không có chỗ nào trong code hiện tại trỏ tới file này, giữ lại chỉ
  để tham khảo lịch sử.

## Firebase — 2 tính năng dùng 2 nhánh dữ liệu khác nhau

Project mặc định hiện tại (`desktop/index.html`, `docs/index.html`): `qrremod`.

| Tính năng | Nhánh dữ liệu | Ai ghi/đọc |
|---|---|---|
| QR Remote Input | `sessions/{id}/data` | Điện thoại ghi, máy tính đọc |
| Truyền tệp | `rooms/{mã 6 số}` (+ `viewers/`, `offer`, `iceCandidatesHost`...) | App điện thoại ghi, máy tính đọc/ghi |

**Rules cần đủ CẢ HAI nhánh** — dán thiếu 1 trong 2 sẽ làm tính năng còn lại
báo lỗi quyền (permission denied) hoặc kẹt vô hạn ở trạng thái "đang kết nối":

```json
{
  "rules": {
    "sessions": {
      ".read": true,
      ".write": true
    },
    "rooms": {
      "$roomCode": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

## Build

```
cd desktop
npm install
npm start          # chạy thử
npm run build      # đóng gói .exe (NSIS) bằng electron-builder
```

## Nguyên tắc thiết kế cần giữ nguyên khi chỉnh sửa

- 2 tính năng (QR Remote Input và Truyền tệp) dùng 2 nhánh Firebase **riêng biệt**
  (`sessions` và `rooms`) — không gộp chung hay đổi rules của nhánh này khi
  chỉ định sửa nhánh kia.
- Truyền tệp: tệp phải được ghi/đọc **từng đoạn**, không gom cả tệp vào RAM
  (cả chiều nhận lẫn chiều gửi) để tệp lớn vẫn truyền được.
- Dữ liệu trình duyệt (dấu trang/lịch sử/mật khẩu/cài đặt) lưu file thật qua
  `localStoreBridge`, không dùng `localStorage` (mất khi xoá cache trình
  duyệt vì đây là nội dung `<webview>`, không phải trang top-level).
- Cửa sổ dùng khung tự vẽ (`frame:false`) — mọi thay đổi liên quan tới
  thu nhỏ/phóng to/đóng/kéo-giãn cửa sổ đều phải test kỹ vì không dùng cơ chế
  mặc định của hệ điều hành.

## Chế độ chỉ cùng mạng (LAN only)

Mặc định bản này **chỉ kết nối khi điện thoại và máy tính cùng Wi-Fi hoặc cùng hotspot**.

- Không dùng STUN/TURN, bỏ mọi đường đi qua Internet; tệp đi thẳng giữa 2 máy.
- Vẫn dùng Firebase để 2 máy tìm thấy nhau, nên mạng vẫn cần có Internet (4G của máy phát hotspot cũng được).
- Khác mạng sẽ không kết nối được (đúng chủ ý).
- Muốn trở lại như cũ (cả khi khác mạng): đổi `LAN_ONLY = false` (file JS/HTML) hoặc `LanOnly.ENABLED = false` (`webrtc/LanOnly.kt`).
- Lần đầu mở trên Windows, hãy bấm **Cho phép (Allow)** ở hộp thoại Tường lửa cho mạng riêng.
- Nếu Wi-Fi công cộng bật "cách ly thiết bị", hãy dùng hotspot riêng.
