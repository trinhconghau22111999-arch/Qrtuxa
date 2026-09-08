# Qrtuxa — trình duyệt desktop + nhập liệu từ xa bằng QR + xem webcam điện thoại

Ứng dụng desktop (Electron, chạy trên Windows) có 3 phần:

1. Một **trình duyệt web đầy đủ tính năng** (thẻ tab, dấu trang, lịch sử, tải
   xuống, mật khẩu đã lưu, chặn quảng cáo, chặn web đen/lừa đảo, mở link 1
   chạm, đổi màu giao diện).
2. **QR Remote Input** — tính năng gốc của app: quét mã QR/mã vạch bằng camera
   điện thoại, nội dung quét được sẽ **gõ thẳng vào vị trí con trỏ đang chọn
   trên máy tính** — như một máy quét mã vạch không dây dùng điện thoại.
3. **QR Cam** — xem camera của điện thoại đang chạy app
   [QrtuxaCam](https://github.com/trinhconghau22111999-arch/QrtuxaCam) ngay
   trên máy tính qua WebRTC, tối đa 4 điện thoại cùng lúc, có thể quay lại màn
   hình đang xem theo lịch hẹn giờ.

`package.json` hiện đặt tên nội bộ là `qr-remote-input-browser` (tên gốc lúc
mới chỉ có tính năng #2) — tên hiển thị trong cửa sổ app là **"QR Remote
Browser"**; "Qrtuxa" là tên repo/thương hiệu dùng khi nhắc tới app này từ phía
điện thoại (VD dòng chữ "Nhập mã này vào QR Cam trên máy tính (Qrtuxa)" trong
app QrtuxaCam).

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

## 3. QR Cam — xem webcam điện thoại

Cần điện thoại cài app
[QrtuxaCam](https://github.com/trinhconghau22111999-arch/QrtuxaCam) (xem
README repo đó để biết cách lấy mã 6 số).

- Bấm nút **"📷 QR Cam"** để mở panel nhập mã, tối đa **4 ô** (4 điện thoại
  cùng lúc), mỗi ô nhập 1 mã 6 số riêng.
- **Panel chỉ hoạt động lúc đang mở**: mở panel sẽ tự kết nối lại bằng mã đã
  lưu (nếu có); đóng panel sẽ tạm ngắt hết kết nối (không xoá mã đã lưu) —
  **trừ** ô nào đang quay video theo lịch hẹn giờ (xem bên dưới), ô đó vẫn giữ
  kết nối ngầm dù đóng panel.
- Mã 6 số nhập vào **lưu vĩnh viễn** trong ô, không tự mất — chỉ mất khi bấm
  ✕ hoặc nhập mã khác đè lên.
- Bấm "Xem trực tiếp" để xem lưới tối đa 4 camera cùng lúc; nút Đóng nằm ở
  góc trên-phải overlay.
- **Quay video theo lịch**: mỗi ô có nút ⏺ (quay/dừng tay) và nút ⚙ (đặt lịch
  — giờ bắt đầu + giờ kết thúc, lặp lại mỗi ngày). Lần đầu dùng cho 1 ô cần
  bấm ⏺ ít nhất 1 lần để chọn thư mục lưu (hộp thoại thật của Windows); các
  lần quay theo lịch sau đó tự dùng lại đúng thư mục đã chọn, không hỏi lại.
  File lưu dạng `.webm`, đặt tên theo giờ quay
  (`qrcam_dt{số ô}_{ngày}_{giờ}.webm`). Ô có lịch đang bật sẽ tự kết nối ngay
  từ lúc mở app, không cần mở panel trước.

### Ghi chú

- `docs/cam.html` là bản thiết kế **cũ, không còn được dùng** (cách tiếp cận
  chụp từng khung hình qua canvas, trước khi chuyển hẳn sang WebRTC thật của
  app QrtuxaCam) — không có chỗ nào trong code hiện tại trỏ tới file này, giữ
  lại chỉ để tham khảo lịch sử.

## Firebase — 2 tính năng dùng 2 nhánh dữ liệu khác nhau

Project mặc định hiện tại (`desktop/index.html`, `docs/index.html`): `qrremod`.

| Tính năng | Nhánh dữ liệu | Ai ghi/đọc |
|---|---|---|
| QR Remote Input | `sessions/{id}/data` | Điện thoại ghi, máy tính đọc |
| QR Cam | `rooms/{mã 6 số}` (+ `viewers/`, `offer`, `iceCandidatesHost`...) | App QrtuxaCam ghi, máy tính đọc/ghi |

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

- 2 tính năng QR (Remote Input và QR Cam) dùng 2 nhánh Firebase **riêng biệt**
  (`sessions` và `rooms`) — không gộp chung hay đổi rules của nhánh này khi
  chỉ định sửa nhánh kia.
- QR Cam: panel đóng phải ngắt kết nối các ô KHÔNG có lịch quay đang bật, để
  tránh giữ kết nối ngầm không cần thiết khi không ai theo dõi.
- Dữ liệu trình duyệt (dấu trang/lịch sử/mật khẩu/cài đặt) lưu file thật qua
  `localStoreBridge`, không dùng `localStorage` (mất khi xoá cache trình
  duyệt vì đây là nội dung `<webview>`, không phải trang top-level).
- Cửa sổ dùng khung tự vẽ (`frame:false`) — mọi thay đổi liên quan tới
  thu nhỏ/phóng to/đóng/kéo-giãn cửa sổ đều phải test kỹ vì không dùng cơ chế
  mặc định của hệ điều hành.
