# English Study iOS PWA V1.0

Baseline chức năng: Android English Study V1.12. Đây là nhánh iPhone/PWA riêng, không thay đổi Android V1.12.

## Logic đã chốt

1. App KHÔNG đóng sẵn 10.000 từ.
2. Người dùng import `.xlsx`, `.csv`, `.txt` hoặc dán danh sách từ.
3. Import chuẩn hóa + chống trùng theo `normalizedWord`.
4. AI xử lý text theo batch tối đa 25 từ: `meaningVi`, `partOfSpeech`, `exampleEn`, `exampleVi`, `ipaUS`, `ipaUK`.
5. Audio KHÔNG sinh khi import/enrichment.
6. Khi bấm **HỌC 10 TỪ**, người dùng chọn US hoặc UK. App chỉ tạo/cache audio đúng accent cho 10 từ đang học, tối đa 2 request TTS song song.
7. Nếu audio đã cache, phát local và không gọi API lại.
8. Nếu Gemini TTS thất bại, phát tạm bằng giọng hệ thống iPhone (`speechSynthesis`).
9. AI Project Pool tách riêng Vocabulary và Speech/Listening. 429/503 đặt cooldown theo từng project/capability.
10. PWA lưu checkpoint bằng IndexedDB. Khi iOS suspend app, mở lại app sẽ tiếp tục các từ `PENDING`.

## Cài lên GitHub Pages

### Cách dễ nhất: repository riêng

1. Tạo repository mới, ví dụ `english-study-ios`.
2. Upload TOÀN BỘ file/thư mục bên trong ZIP này lên root repo, gồm cả `index.html`, `js`, `icons`, `sw.js`.
3. GitHub > repository > **Settings** > **Pages**.
4. Source: **Deploy from a branch**.
5. Branch: `main`, folder: `/ (root)` > Save.
6. Chờ GitHub báo địa chỉ Pages.
7. Mở địa chỉ đó bằng Safari trên iPhone.
8. Share > **Add to Home Screen** > Add.

Không dùng TestFlight, IPA hoặc Apple Developer Program cho bản PWA này.

## Thiết lập AI lần đầu

Mở **Cài đặt**:

- `Gemini Project Pool • Từ vựng`: mỗi dòng một API key từ một Google Cloud Project khác nhau.
- `Gemini Project Pool • Luyện nghe / phát âm`: mỗi dòng một API key từ một Google Cloud Project khác nhau.
- Có thể bật Groq backup cho text.
- Mặc định text model: `gemini-3.1-flash-lite`.
- Mặc định TTS model: `gemini-3.1-flash-tts-preview`.
- Chọn accent mặc định US hoặc UK.
- Bấm **LƯU CÀI ĐẶT**.

Khuyến nghị tách project text và speech để quota không tranh nhau.

## File 10.000 từ

### Excel `.xlsx`

Cách tốt nhất:

| word |
|---|
| appointment |
| career |
| assignment |

App nhận các header phổ biến: `word`, `english`, `vocabulary`, `vocab`, `từ`, `từ vựng`, `english word`, `word/phrase`, `phrase`.

Nếu không có header, app lấy cột đầu tiên của sheet 1.

`.xls` đời cũ không hỗ trợ. Save As thành `.xlsx` hoặc `.csv`.

### CSV/TXT

Mỗi dòng một từ là ổn định nhất.

## Xử lý AI 10.000 từ

Sau import, app tự xử lý khi PWA đang mở/active:

`PENDING -> PROCESSING -> READY`

Mỗi batch tối đa 25 từ. Kết quả được lưu ngay sau từng batch.

iOS có thể suspend PWA khi khóa màn hình/chuyển app. Vì vậy đây không phải WorkManager Android. Khi mở app lại, app tiếp tục các từ còn `PENDING` thay vì chạy lại từ đầu.

## Học 10 từ / audio

`HỌC 10 TỪ` chọn các từ READY, ưu tiên từ đến hạn ôn/mức mastery thấp rồi bổ sung từ mới.

Chọn:

- 🇺🇸 US -> chỉ tìm/tạo cache US.
- 🇬🇧 UK -> chỉ tìm/tạo cache UK.

Không tạo 20.000 file audio ngay từ đầu.

## Backup

- `Backup dữ liệu`: từ vựng + mastery + dialogue + cài đặt không bí mật.
- `Xuất cấu hình AI`: có chứa API keys. File này phải giữ kín.
- `Khôi phục` và `Nhập cấu hình AI` dùng khi chuyển sang iPhone khác.

## Bảo mật API key

API keys được mã hóa bằng AES-GCM với Web Crypto và khóa thiết bị được lưu trong IndexedDB. Tuy nhiên PWA không có vùng bí mật tương đương backend server: mã JavaScript chạy trên chính thiết bị có quyền dùng khóa. Không public file cấu hình API và không đưa API key trực tiếp vào source GitHub.

## Giới hạn có chủ ý

- Không chạy nền liên tục khi iPhone khóa màn hình.
- Không hỗ trợ PDF ở iOS V1.0 này. Với bộ 10.000 từ nên dùng `.xlsx`, `.csv` hoặc `.txt` để nhập chính xác và nhanh.
- Excel chỉ đọc sheet đầu tiên; mục tiêu là file một cột `word`.
