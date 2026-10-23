# Đánh giá sản phẩm Vclarity — 23/10/2026

**Kết luận:** Vclarity đã có luồng chức năng thực tế cho phạm vi Phase 1: đo DOM, chọn và chụp vùng giao diện, xử lý màu tại máy, phân tích AI có sự đồng ý, hiển thị kết quả và sao chép báo cáo. Sau đợt rà soát này, sản phẩm phù hợp để sử dụng và tiếp tục thử nghiệm dưới dạng **beta có đầy đủ chức năng cốt lõi**. Chưa có đủ bằng chứng để xác nhận toàn bộ yêu cầu “production-grade” trên mọi phiên bản Chrome, hệ điều hành và website.

Bản đánh giá đối chiếu bản yêu cầu sản phẩm ban đầu với mã nguồn, hợp đồng dữ liệu, kiểm thử tự động, bản build và bằng chứng chạy trình duyệt. Các kết quả kiểm thử ngày 23/10 được phân biệt với lần gọi Gemini thật đã thực hiện trước đó. Đợt rà soát này không thực hiện một lần sinh kết quả AI mới và không dùng ảnh từ website cá nhân. Credential không được công bố trong tài liệu hoặc gói extension.

Tài liệu liên quan: [hướng dẫn cài đặt](../README.md), [kiến trúc](architecture.md), [bảo mật và quyền riêng tư](security.md), [bằng chứng xác minh](verification.md), [ý nghĩa phép đo](measurements.md), [phạm vi đo hiệu năng](performance.md).

## 1. Đối chiếu yêu cầu và mức độ hoàn thành

“Đã có và đã kiểm thử” trong bảng dưới đây chỉ áp dụng cho phạm vi bằng chứng được nêu. “Cần xác minh thêm” không có nghĩa là chức năng chắc chắn hỏng; đó là phần chưa được kiểm tra đủ để đưa ra bảo đảm phát hành rộng rãi.

| Hạng mục trong yêu cầu ban đầu | Trạng thái hiện tại | Chức năng và bằng chứng | Giới hạn hoặc phần còn thiếu |
| --- | --- | --- | --- |
| Chrome MV3 và native Side Panel | Đã có; đã chạy trình duyệt | Manifest, service worker, inspector và `sidepanel.html` là mã thực. Đường mở/đóng native panel qua toolbar đã được thực thi trong kiểm thử. | Phần lớn ảnh kiểm thử hiển thị trang extension trong một tab. Cần kiểm tra giao diện dock, thay đổi chiều rộng và hành vi cửa sổ trên Chrome desktop thực tế. |
| Live Inspect và đo DOM/CSS | Đã có và đã kiểm thử | Hover highlight, chọn phần tử, chặn click chọn để tránh kích hoạt trang, đọc computed CSS và rendered bounds, Escape và dọn overlay. Fixture xác minh font 16 px, weight 600, padding 12 px, radius 8 px, nút 160 × 48 và màu nền đã biết. | Computed CSS không chứng minh khai báo CSS gốc. Font family không xác định font thực tế cho từng glyph; bounds có thể bao gồm transform. |
| Ghost Inspect và crop ảnh | Đã có và đã kiểm thử | Kéo nhiều hướng; dùng `captureVisibleTab`; bỏ overlay trước chụp; kiểm tra tab/viewport; tính crop từ kích thước bitmap thực và viewport. Có kiểm thử viewport và device scale factor khác nhau. | Cần smoke test thêm với page zoom, nested scroll và ứng dụng thật. Pinch zoom/panning bị từ chối có thông báo. |
| Palette và image worker | Đã có và đã kiểm thử | Decode, crop, lấy pixel, sampling, gom màu theo độ gần cảm nhận và tính tỷ lệ chạy trong worker. Fixture màu đã biết cho ra năm nhóm màu và tỷ lệ tương ứng. | Đây là màu chiếm ưu thế trong ảnh, không phải bảng design token hay CSS của trang. Gradient, ảnh và antialiasing ảnh hưởng kết quả. |
| Tối ưu ảnh trước AI | Đã có; đã sửa một bất nhất giới hạn | Thử WebP/JPEG, nhiều mức chất lượng/kích thước, mục tiêu dưới 100.000 byte, có giới hạn độ đọc và cảnh báo khi vượt mục tiêu mềm. Extension và API dùng chung ngân sách pixel cho ảnh đã encode. | Không bảo đảm mọi vùng đều xuống dưới 100 KB. Khi không thể giữ độ đọc trong giới hạn cứng, yêu cầu người dùng chọn vùng nhỏ hơn. |
| Hai tab Design Specs / Product & UX Insights | Đã có; đã sửa luồng tab trống | Cả hai tab hoạt động. Insights có lời hướng dẫn và nút Start Ghost Inspect riêng khi chưa có dữ liệu, có preview trước gửi và đường mở Settings. | Giao diện hiện dùng tiếng Anh. Bản địa hóa chưa phải chức năng đã triển khai. |
| Consent, tiến trình và retry AI | Đã có; đã sửa khả năng nhìn thấy trạng thái | Không tự gửi ảnh sau khi chọn. Có checkbox đồng ý, xác nhận ảnh vượt mục tiêu dung lượng, trạng thái chờ, hủy, lỗi và retry ảnh đang còn trong bộ nhớ. Phân tích lại giữ dữ liệu cũ và hiển thị trạng thái mới. | Retry sau khi đóng panel hoặc bỏ ảnh cần chụp lại. Điều này là chủ đích về vòng đời dữ liệu. |
| Settings, lưu và kiểm tra kết nối | Đã bổ sung và kiểm thử | Enter hoặc Save connection lưu lựa chọn. Có Remember, Test connection, trạng thái kết nối, khôi phục sau mở lại và Forget saved token. Browser test kiểm tra lưu, mở lại, quên token và chế độ không ghi nhớ. | Đây là lưu token của dịch vụ local; không cấu hình provider key trong giao diện. Backend vẫn phải được khởi động riêng. |
| API và bảo mật đầu vào | Đã có và đã kiểm thử | Hono chạy loopback; token bắt buộc; kiểm tra Host/Origin; giới hạn body, image header, byte, dimension, pixel; rate/concurrency limit; deadline và abort; lỗi được chuẩn hóa. `/connection` cũng yêu cầu token. | Phù hợp mô hình backend local một người dùng. Chưa có thiết kế triển khai public nhiều người dùng, TLS, tài khoản hay quota phân tán. |
| Gemini thật | Đã có bằng chứng live trước đợt rà soát này | Lần gọi fixture đã đi qua route có xác thực, validation JPEG, adapter Gemini và shared response schema; chi tiết ở phần 3. | Không có lần sinh kết quả Gemini mới trong đợt audit này. Kết quả trước đó không bảo đảm quota hoặc credential sẽ luôn còn dùng được. |
| OpenAI và Ollama | Adapter thực; mức xác minh khác Gemini | Request/response transport, normalization và lỗi được kiểm thử bằng mock. Ollama kiểm tra capability trước gửi ảnh. `gpt-oss:120b` được nhận diện là text-only và trả lỗi rõ ràng trước khi gửi screenshot. | Chưa có bằng chứng live inference cho OpenAI hoặc Ollama. Không được mô tả `gpt-oss:120b` là provider có thể phân tích ảnh. Không tự đổi sang model khác. |
| Output schema và phân biệt quan sát/suy luận | Đã có và đã kiểm thử | Shared Zod schema, evidence, confidence, observed/inferred, unknowns và validation questions. Output không hợp lệ, bị từ chối hoặc thiếu không được thay bằng kết quả giả. | Schema bảo đảm cấu trúc, không chứng minh nhận định AI là đúng. Hành vi ẩn và business rule cần xác minh độc lập. |
| Clipboard và Copy Note | Đã có và đã kiểm thử | Sao chép palette, design specs, UX, product logic và báo cáo đầy đủ từ state đã validation. Có phản hồi thành công/lỗi; nguồn và độ tin cậy được giữ trong Markdown. | Chưa có JSON export hoặc kho lịch sử báo cáo riêng. Đây là tính năng mở rộng, không phải nút giả hay chức năng clipboard bị thiếu. |
| State theo tab, session và vòng đời | Đã có; đã sửa race khởi tạo context | Có session/request UUID, state transition, hàng đợi theo tab, tách cửa sổ, reconnect service worker và loại kết quả đến muộn. Đã thêm guard để phản hồi context cũ không ghi đè sự kiện mới hơn. | Vẫn cần kiểm tra idle lâu, suspend/resume và nhiều ứng dụng thực tế. Báo cáo nhẹ có thể được khôi phục; screenshot không được lưu để khôi phục. |
| Accessibility | Đã triển khai một phần và kiểm thử chọn lọc | Có label, focus visible, điều hướng tab bằng bàn phím, live status, phân loại bằng chữ, source tooltip dùng bàn phím và reduced motion. Layout hẹp đã được kiểm tra. | Chưa thực hiện đánh giá WCAG toàn diện hoặc kiểm thử đầy đủ với screen reader. Không có cơ sở tuyên bố không còn mọi lỗi accessibility. |
| Hiệu năng | Có kiến trúc giới hạn công việc và benchmark | Pointer DOM reads qua animation frame; image pipeline ở worker; giới hạn sampling; benchmark palette có fixture và thông tin máy. | Benchmark chỉ đo hàm palette, không đo toàn bộ capture → encode → UI hay độ mượt trên mọi website/máy. |
| Build, phân phối và onboarding | Có source, build và gói extension; còn thao tác thủ công | Có pnpm workspace, README, `.env.example`, build MV3 và API, hướng dẫn Load unpacked. Bản cập nhật đích là 0.1.1. | ZIP chỉ chứa extension; không tự cài Node/backend, không tự chạy dịch vụ và không phải bản phát hành Chrome Web Store. |

Các hệ thống trong brief đã được triển khai thành mã chạy được, không dừng ở mockup sidebar. Những giới hạn chủ yếu còn lại nằm ở xác minh phát hành, trải nghiệm cài đặt backend và các tính năng ngoài phạm vi Phase 1.

## 2. Sáu vấn đề được sửa trong đợt rà soát

| Vấn đề trước khi sửa | Tác động đối với người dùng | Thay đổi hiện tại | Nơi triển khai/bằng chứng |
| --- | --- | --- | --- |
| Insights trống nhưng không có hành động bắt đầu rõ ràng | Tab có thể bị hiểu là chưa hoạt động hoặc không biết cần làm gì tiếp. | Có màn hình hướng dẫn riêng, nút Start Ghost Inspect, đường mở Settings và trạng thái phù hợp khi cần chụp lại. | `components/Insights.tsx`; browser scenario về Insights starter. |
| Nhập token không có thao tác lưu, Enter và persistence rõ ràng | Người dùng không biết giá trị đã áp dụng chưa; mở lại panel phải nhập lại. | Settings dùng form, Enter/Save connection, thông báo chưa lưu, Remember, Test connection và Forget saved token. Lưu vẫn có kết quả rõ ràng khi backend offline. | `components/ConnectionSettings.tsx`, `lib/panel/settings.ts`; unit test và browser test lưu/mở lại/xóa. |
| Tiến trình hoặc retry bị khuất khi đã có kết quả phân tích trước đó | Khó biết lần phân tích lại đang chạy; khi lỗi khó tìm thao tác thử lại. | Hiển thị tiến trình và retry ở vị trí trực tiếp trong Insights, đồng thời giữ local data và kết quả cũ phù hợp. | `components/Insights.tsx`; kiểm thử luồng AI lỗi/retry và hiển thị trạng thái. |
| Context ban đầu của tab khác có thể đến muộn | Một phản hồi GET_CONTEXT cũ có thể thay thế context mới sau sự kiện chuyển tab. | Dùng revision của sự kiện và cửa sổ đang bind để bỏ phản hồi khởi tạo đã lỗi thời. | `lib/panel/client.ts`; regression test context đến muộn. |
| Giới hạn pixel ảnh encode ở extension không khớp API | Một ảnh được chuẩn bị ở máy có thể chỉ bị từ chối sau khi gửi vì vượt ngân sách pixel của API. | Dùng chung `MAX_ENCODED_IMAGE_PIXELS = 16_777_216`; chỉ chọn encoding candidate trong ngân sách và vẫn bảo vệ độ đọc. Nếu không thể đáp ứng, báo chọn vùng nhỏ hơn ngay tại local pipeline. | `packages/shared`, `lib/image/optimize.ts`, `apps/api/src/validation/image.ts`; kiểm thử biên candidate và schema. |
| Panel timeout 90 giây nhưng API cho phép tới 120 giây | Cấu hình server hợp lệ vẫn có thể bị phía panel hủy trước khi hết deadline đã chọn. | Panel chờ tối đa 130 giây, dài hơn mức API tối đa 120 giây; mặc định backend vẫn là 45 giây. | `lib/panel/client.ts`, `apps/api/src/config.ts`; kiểm tra TypeScript và regression suite. |

Các thay đổi này sửa vấn đề sử dụng và tính nhất quán thực tế. Chúng không mở rộng scope sang dựng lại website, sinh code giao diện hoặc tự động thao tác website.

Các chi tiết liên quan cũng đã được sửa: bắt đầu inspection mới giữ tab kết quả người dùng đang chọn; cấu hình local token đã biết bị từ chối chặn gửi AI cho đến khi sửa; nếu Forget saved token gặp lỗi storage thì UI không giả vờ đã xóa token hoặc tự làm trống ô nhập. Các trường hợp này thuộc regression coverage của lượt kiểm tra cuối.

## 3. Bằng chứng xác minh và cách hiểu kết quả

### Kiểm tra mới trong ngày 23/10/2026

| Kiểm tra | Kết quả của lượt xác minh cập nhật |
| --- | --- |
| Unit và integration tests | **228 tests đạt trong 17 suites**. |
| Browser scenarios | **4/4 đạt** với production MV3 build và fixture có kiểm soát. |
| TypeScript | `pnpm typecheck` đạt. |
| Lint | `pnpm lint` đạt. |
| Production build | `pnpm build` đạt cho extension và API. |
| Backend process thực tế | `GET /health` trả **200**; `GET /connection` với local token đúng trả **200**; `/connection` không có token trả **401**. |
| Ảnh Settings đã lưu ở chiều rộng 300 px | Đã chụp và xem ảnh thực tế; kiểm tra trạng thái lưu/kết nối và bố cục hẹp. |
| Gói extension 0.1.1 | ZIP **160.275 byte**; 12 file trong ZIP, thư mục unpacked và `.output` trùng byte; có SHA-256 được ghi lại. |
| Kiểm tra credential trong bundle | Đã quét output build theo provider key và local token đang cấu hình; không tìm thấy các giá trị đó trong bundle. Giá trị credential không được in trong tài liệu. |

Lần kiểm tra backend process trên chỉ xác minh route local, xác thực và metadata cấu hình. `/connection` không gửi ảnh, không gọi provider, không chạy inference và không sử dụng ngân sách request phân tích. Vì vậy HTTP 200 ở đây không chứng minh provider key, quyền model hoặc quota đang dùng được.

Kiểm thử trình duyệt chạy với bản MV3 thực, service worker, content script, screenshot API, worker, clipboard và state thực. Riêng kết quả AI trong browser test dùng mock có chủ đích để xác minh lỗi, retry và hiển thị một cách xác định; mock không tồn tại dưới dạng fallback thành công trong production.

Phần lớn kiểm tra layout chụp trang `sidepanel.html` của extension trong một tab. Đường mở và đóng native panel được kiểm tra riêng qua toolbar. Cách này xác minh nội dung thật của extension và nhiều hành vi Chrome, nhưng không thay thế việc nhìn và thao tác docked panel trên desktop thực tế. Bốn browser scenarios gồm nhiều assertion; con số 4 không có nghĩa chỉ có bốn phép kiểm tra, cũng không có nghĩa đã phủ hết các trường hợp trên mọi website.

Ảnh 0.1.1 đã xem ở chiều rộng 300 px: [Insights starter](screenshots/insights-starter-0.1.1.png) và [Settings sau khi lưu kết nối](screenshots/connection-saved-0.1.1.png). Các ảnh dùng dữ liệu fixture của kiểm thử.

### Lần gọi Gemini thật trước đó

[Verification log](verification.md) đã ghi nhận một lần phân tích thật bằng `gemini-3.5-flash-lite` trước đợt audit ngày 23/10:

- Ảnh JPEG fixture cục bộ **900 × 194**, **14.661 byte**.
- Đi qua route phân tích có local token, validation ảnh, transport Gemini và validation toàn bộ response.
- Trả **HTTP 200**, **2 UX insights**, **7 observed elements** và **1 limitation**.
- Request ID và response vượt qua shared Zod schema.
- Có một lần lỗi tạm thời trước đó; một lần thử lại được thực hiện rõ ràng và thành công. Không tự đổi provider/model.

Đây là bằng chứng integration thật đã chạy, không phải kết quả mới được sinh trong lần audit này. Nó không xác nhận lại credential hiện tại, không tạo cam kết quota và không chứng minh mọi screenshot đều phân tích thành công. OpenAI/Ollama tiếp tục được xác minh ở mức adapter/mock trong bằng chứng hiện có.

### Hiệu năng được đo đến đâu

Benchmark đã lưu trong [performance.md](performance.md) đo riêng `extractPalette()` trên fixture tổng hợp với tối đa 12.000 mẫu pixel. p95 đã ghi nhận lần lượt **2,52 / 0,97 / 1,08 ms** cho fixture nhỏ/vừa/lớn trên máy tham chiếu.

Không nên chuyển các số này thành tuyên bố “mọi phân tích dưới 50 ms”. Capture, decode, crop, đọc canvas, khởi động worker, encode, network và render UI không nằm trong thời gian benchmark đó. Worker và giới hạn công việc hỗ trợ độ phản hồi, nhưng vẫn cần đo luồng đầy đủ trên máy và website mục tiêu.

## 4. Bảo mật và vòng đời dữ liệu sau thay đổi Settings

Hai loại token/key có mục đích khác nhau:

| Giá trị | Đặt ở đâu | Dùng để làm gì |
| --- | --- | --- |
| `API_ACCESS_TOKEN` | Backend `.env` và Settings của extension | Xác thực extension với dịch vụ local tại `127.0.0.1:4317`. |
| `AI_API_KEY` hoặc alias provider tương ứng | Chỉ trong environment của backend | Xác thực backend với Gemini/OpenAI/Ollama. Không nhập vào Settings extension. |

Settings có thể lưu **local service token** bằng `chrome.storage.local` khi người dùng bật Remember và lưu. Storage được giới hạn `TRUSTED_CONTEXTS`; content script inspector không cần credential này. Đây là dữ liệu local thông thường trong Chrome profile, **không phải kho khóa được mã hóa riêng**. Có thể dùng Forget saved token, hoặc tắt Remember trước khi lưu để chỉ giữ token trong panel hiện tại.

Ảnh và preview vẫn là dữ liệu tạm thời. Đóng panel, chuyển tab, bắt đầu inspection mới hoặc hủy sẽ bỏ capture hiện tại theo thiết kế. Lưu local token không làm ảnh được lưu theo. Báo cáo nhẹ được giữ trong `chrome.storage.session`; chúng có thể chứa đường dẫn trang, selector, CSS và nội dung phân tích, nhưng không chứa screenshot hoặc provider key.

Luồng AI vẫn yêu cầu đồng ý cho ảnh đang chọn. Đã lưu token hoặc Test connection thành công không thay cho consent và không tự gửi screenshot. `imageAnalysisSupported: null` nghĩa là local connection check chưa xác minh capability; `false` được dùng cho cấu hình Ollama GPT-OSS đã biết không hỗ trợ ảnh.

API bảo vệ endpoint bằng token, loopback binding, kiểm tra Host/Origin, giới hạn body/ảnh/request, abort/deadline và output schema. Những biện pháp này phù hợp backend local, không phải chứng nhận an toàn cho việc mở API ra Internet. Model output vẫn là nội dung không đáng tin để thực thi; UI hiển thị text, không inject HTML từ AI.

## 5. Giới hạn có chủ đích và phần chưa được chứng nhận

Các trường hợp sau là giới hạn phạm vi được thông báo, không phải dấu hiệu một nút đang bị hỏng:

- Không inspect nội dung iframe hoặc closed Shadow DOM; iframe element và open Shadow DOM nằm trong phạm vi hỗ trợ đã nêu.
- Không inspect Chrome internal pages, Chrome Web Store hoặc trang không phải HTTP(S).
- Không hỗ trợ pinch zoom/visual viewport panning; có thông báo yêu cầu chọn lại.
- Không suy ra chính xác CSS, font, kích thước authored hoặc business rules từ screenshot.
- Không giữ screenshot để dùng lại sau khi panel đóng; cần chụp lại khi muốn phân tích ảnh đã bị bỏ.
- Không tự đổi provider/model, mua quota, bật billing hoặc giả kết quả khi provider thất bại.
- Không cung cấp code generation, site reconstruction, tự click/submit website hay lịch sử ảnh tự động trong Phase 1.

Những phần cần xác minh thêm gồm Chrome 116 thực tế, shortcut vật lý, native docking, screen reader, nhiều hệ điều hành và website phức tạp. Không được suy rộng kết quả trên Chromium mới và fixture sang toàn bộ các môi trường đó.

## 6. Mức sẵn sàng và ưu tiên tiếp theo

### P1 — Trước khi phát hành rộng hơn

1. **Kiểm tra Chrome desktop mục tiêu**, bao gồm baseline Chrome 116 nếu tiếp tục công bố hỗ trợ 116+, đồng thời kiểm tra phiên bản Chrome hiện dùng của nhóm.
2. **Bấm shortcut vật lý** Alt+I/Alt+S; kiểm tra xung đột hệ điều hành/extension khác và hướng dẫn đổi tại `chrome://extensions/shortcuts`. Headless key injection không thay thế bước này.
3. **Kiểm tra native panel docked**: toolbar, mở/đóng, kéo chiều rộng, nhiều cửa sổ, chuyển focus, reset extension và thao tác liên tục.
4. **Smoke test trên ứng dụng thật** có React/Vue, nested scroll, nhiều component, transform và nội dung dài; kiểm tra page zoom, scroll trong lúc capture và navigation.
5. **Để idle và thử worker suspend/resume** lâu hơn test ngắn, rồi kiểm tra context, reconnect, báo cáo cũ và quy trình chụp lại.

Đây là các bước hoàn thiện bằng chứng phát hành. Chưa có lỗi nghiêm trọng mới được xác nhận từ backend/security audit ngoài các bất nhất đã sửa, nhưng phạm vi kiểm thử hiện tại không đủ để khẳng định không còn lỗi trong mọi điều kiện.

### P2 — Cải thiện trải nghiệm và khả năng vận hành

- **Onboarding backend đơn giản hơn:** cung cấp một hành động rõ ràng để khởi động dịch vụ local hoặc hướng dẫn tích hợp phù hợp, thay cho việc người mới phải tự nối nhiều bước terminal. Hiện extension không tự bật backend.
- **Làm rõ local token ngay từ đầu:** tiếp tục giải thích `API_ACCESS_TOKEN` khác provider key; trạng thái lưu, trạng thái backend và trạng thái provider nên được phân biệt. Save/Test mới đã giải quyết phần quan trọng của sự nhầm lẫn này.
- **Provider diagnostics có chủ đích:** có thể thêm kiểm tra metadata/capability và hướng dẫn lỗi quota, nhưng không tự chạy inference hoặc tiêu quota chỉ vì mở Settings. Mọi live image test cần thao tác rõ ràng.
- **Report history / JSON export, nếu cần:** mở rộng trên validated state, có lựa chọn lưu/xóa và disclosure dữ liệu phù hợp. Không tự lưu screenshot để đáp ứng nhu cầu lịch sử.
- **i18n, nếu cần:** tách chuỗi UI và hỗ trợ tiếng Việt hoặc ngôn ngữ khác. Chưa phải điều kiện để chức năng hiện tại hoạt động, nhưng hữu ích nếu nhóm người dùng chính không dùng tiếng Anh.

## 7. Cập nhật lên gói 0.1.1 và chạy đúng backend

Gói đã đóng của đợt sửa là [releases/vclarity-0.1.1-chrome.zip](../releases/vclarity-0.1.1-chrome.zip), với thư mục unpacked `releases/vclarity-0.1.1-chrome`. ZIP chỉ có extension; backend và các tệp cấu hình vẫn thuộc repository. SHA-256 của ZIP: `60f6df0b95cb2cbc256088e02da74f96f550e6ce3bb237d1568dd4eea4f97bf5`.

1. Đóng panel cũ. Giải nén gói 0.1.1 vào thư mục riêng; không trộn file build mới và cũ.
2. Tại `chrome://extensions`, tắt bản 0.1.0 để tránh nhầm toolbar. Chọn **Load unpacked** và mở thư mục `releases/vclarity-0.1.1-chrome` chứa `manifest.json`. Nếu sử dụng bản build từ source, chọn `apps/extension/.output/chrome-mv3` sau khi build và Reload bản đang trỏ đến thư mục đó.
3. Kiểm tra version 0.1.1 trong Chrome. Đường dẫn unpacked mới có thể tạo extension ID mới; nếu backend đang khóa `API_EXTENSION_ID`, cập nhật nó theo ID hiện tại rồi khởi động lại backend. Token đã lưu của extension ID cũ không được coi là sẽ tự chuyển sang ID mới.
4. Từ repository root, cài dependency nếu cần và khởi động API cập nhật:

   ```powershell
   pnpm install
   pnpm dev:api
   ```

   Nếu dùng backend đã build, chạy `pnpm build` rồi `pnpm --filter @vclarity/api start`. Dừng process backend cũ trước để tránh trùng port. Gói ZIP extension không tự thực hiện các lệnh này.

5. Nếu chưa có cấu hình, sao chép `apps/api/.env.example` sang `apps/api/.env`, tạo local token ngẫu nhiên và cấu hình provider theo [README](../README.md). Không ghi đè một `.env` đang dùng chỉ để cập nhật extension. Giữ port **4317** trừ khi thay cả client endpoint và CSP rồi build lại.
6. Trên một website HTTP(S), bấm toolbar Vclarity để cấp `activeTab`. Mở **Settings**, nhập **API_ACCESS_TOKEN**, chọn Remember nếu muốn, rồi nhấn Enter hoặc **Save connection**.
7. Dùng **Test connection**. Nếu báo backend chưa chạy, khởi động dịch vụ; nếu token bị từ chối, so khớp local token với cấu hình server. Nếu backend cũ trả 404 cho `/connection`, khởi động lại backend từ source/build cập nhật.
8. Chạy Live Inspect hoặc Ghost Inspect. Với AI, xem preview, cấp consent rồi gửi. Test connection thành công chưa xác nhận provider key/quota; lỗi provider cần xử lý riêng theo thông báo.

Sau khi xác minh bản mới, có thể gỡ bản extension cũ nếu không cần giữ để rollback. Các hướng dẫn trên là quy trình cập nhật và kiểm tra, không phải cam kết tự động hóa cài đặt hoặc chứng nhận phát hành production.
