# Thiết kế chuyển website TNC từ Hugo sang Astro và Cloudflare

Ngày phê duyệt: 2026-10-09
Trạng thái: Đã được người dùng duyệt

## 1. Mục tiêu

Chuyển website TNC Handicraft từ Hugo, GitHub Pages và Decap CMS sang một ứng dụng Astro chạy hoàn toàn trên nền tảng Cloudflare. Hệ thống mới phải hỗ trợ:

- Website công khai bằng tiếng Việt, tiếng Anh và tiếng Nhật.
- Astro SSR trên Cloudflare Workers.
- Nội dung có cấu trúc trong Cloudflare D1.
- Hình ảnh và tài liệu trong Cloudflare R2.
- Trang quản trị riêng tại `/admin`.
- Cloudflare Access để xác thực người dùng quản trị.
- Quy trình bản nháp, xem trước và xuất bản.
- Revision, khôi phục nội dung và nhật ký hoạt động.
- Cloudflare DNS, CDN, cache và Workers Builds thay cho GitHub Pages và GitHub Actions deploy.

GitHub tiếp tục lưu mã nguồn. Nội dung hiện tại không được nhập tự động; người quản trị sẽ nhập lại qua trang quản trị. Tên miền chính được chuyển sang hệ thống mới ngay khi phiên bản cơ bản đã được kiểm thử, thay vì đợi nhập đủ toàn bộ nội dung.

## 2. Phạm vi và các quyết định đã chốt

### Trong phạm vi

- Chuyển giao diện hiện tại sang Astro và giữ cấu trúc URL theo ngôn ngữ.
- Homepage có các trường cố định cho menu, hero, giới thiệu, năng lực, sản phẩm, Insights, liên hệ và footer.
- Insights đa ngôn ngữ với slug dùng chung cho một nhóm bản dịch.
- Thiết lập chung và SEO theo từng ngôn ngữ.
- Thư viện media dùng R2.
- Hai vai trò ứng dụng: Admin và Editor.
- Xuất bản độc lập cho từng ngôn ngữ.
- Revision bất biến và khôi phục revision thành bản nháp mới.
- Redirect 301 khi thay đổi slug.
- Homepage tối thiểu để tên miền không hiển thị trang trống trong thời gian nhập nội dung.

### Ngoài phạm vi phiên bản đầu tiên

- Trình dựng trang tự do hoặc kéo thả block.
- Tài khoản và mật khẩu riêng của ứng dụng.
- Workflow duyệt ba cấp Editor, Publisher và Admin.
- Nhập tự động nội dung Hugo/Markdown cũ.
- Ứng dụng di động hoặc API công khai cho bên thứ ba.
- Thương mại điện tử, thanh toán hoặc quản lý đơn hàng.

## 3. Kiến trúc tổng thể

Sử dụng một ứng dụng Astro thống nhất trên Cloudflare Workers. Website công khai, giao diện quản trị và API quản trị nằm trong cùng codebase nhưng được tách thành các module độc lập.

```text
Khách truy cập
  -> Cloudflare DNS/CDN/cache
  -> Astro SSR trên Workers
  -> D1: phiên bản nội dung đã xuất bản
  -> R2: media

Người biên tập
  -> Cloudflare Access
  -> /admin và /api/admin/*
  -> Astro/Worker
  -> D1: nháp, revision, vai trò, audit
  -> R2: media gốc
```

Các nhóm route:

- `/vi/*`, `/en/*`, `/ja/*`: nội dung công khai.
- `/admin/*`: giao diện quản trị.
- `/api/admin/*`: API quản trị.
- `/preview/*`: xem trước bản nháp.
- `/media/*`: cung cấp media từ R2 và các biến thể ảnh.
- `/sitemap.xml`, `/robots.txt`: dữ liệu SEO công khai.

Cloudflare Access phải bảo vệ `/admin/*`, `/api/admin/*` và `/preview/*` ở edge. Worker vẫn xác minh Access JWT trên mọi request thuộc ba nhóm route này. Việc giao diện bị ẩn không được xem là một biện pháp phân quyền.

Các module chính:

- `public-site`: render website công khai từ revision đã xuất bản.
- `admin-ui`: biểu mẫu có cấu trúc và dashboard quản trị.
- `content-service`: validation, draft, preview, publish và restore.
- `auth-service`: xác minh Access JWT và kiểm tra vai trò D1.
- `media-service`: upload, metadata, biến thể ảnh, tham chiếu và soft delete.
- `cache-service`: cache key, header và làm mới cache sau publish.
- `audit-service`: ghi các hành động quản trị quan trọng.

## 4. Xác thực và phân quyền

Cloudflare Access chịu trách nhiệm xác thực danh tính. Ứng dụng không lưu mật khẩu, mã OTP hoặc refresh token. Worker lấy danh tính đã xác minh từ Access JWT, sau đó tra bảng `users` bằng định danh ổn định và email chuẩn hóa.

Quyền:

| Hành động | Editor | Admin |
| --- | --- | --- |
| Xem dashboard và nội dung | Có | Có |
| Tạo/sửa/lưu bản nháp | Có | Có |
| Xem preview | Có | Có |
| Upload và chọn media | Có | Có |
| Xuất bản | Không | Có |
| Khôi phục revision | Không | Có |
| Quản lý vai trò/người dùng | Không | Có |
| Xóa mềm media chưa dùng | Không | Có |

Một người chỉ truy cập được khi đồng thời thỏa mãn chính sách Cloudflare Access và có bản ghi `users` đang hoạt động trong D1. Khóa người dùng trong D1 phải có hiệu lực ngay cả khi phiên Access của họ vẫn còn hạn.

Admin đầu tiên được tạo bằng lệnh bootstrap có chủ đích sau khi Access đã cấu hình. Email được nhập khi chạy lệnh và không được commit vào repository. Sau đó Admin quản lý các bản ghi người dùng trong `/admin/users`; việc cho phép danh tính ở lớp Access vẫn được quản lý trong Cloudflare Zero Trust.

## 5. Mô hình dữ liệu D1

### `users`

- `id`
- `access_subject`
- `email_normalized`
- `display_name`
- `role`: `admin` hoặc `editor`
- `active`
- `created_at`, `updated_at`, `last_seen_at`

`access_subject` là khóa danh tính ưu tiên. Email được dùng để hiển thị và hỗ trợ bootstrap, không phải là bằng chứng xác thực duy nhất sau khi tài khoản đã liên kết.

### `content_items`

- `id`
- `type`: `homepage`, `insight` hoặc `settings`
- `slug`
- `shared_data_json`
- `created_by`, `created_at`, `updated_at`

`homepage` và `settings` là singleton. `insight` có ràng buộc slug duy nhất. `shared_data_json` chỉ chứa dữ liệu dùng chung giữa các ngôn ngữ, ví dụ tham chiếu media chính.

### `content_locales`

- `id`
- `content_item_id`
- `locale`: `vi`, `en` hoặc `ja`
- `draft_data_json`
- `draft_version`
- `published_revision_id`, có thể null
- `updated_by`, `updated_at`

Mỗi cặp `content_item_id` và `locale` là duy nhất. `draft_version` hỗ trợ optimistic concurrency để tránh một người ghi đè thay đổi của người khác.

### `content_revisions`

- `id`
- `content_locale_id`
- `revision_number`
- `data_json`
- `published_by`
- `published_at`
- `source_revision_id`, có thể null

Revision là snapshot bất biến. Khôi phục không sửa revision cũ; hệ thống sao chép snapshot vào `draft_data_json`, tăng `draft_version`, rồi yêu cầu Admin xem trước và xuất bản lại.

### `media`

- `id`
- `r2_key`
- `original_filename`
- `mime_type`
- `byte_size`
- `width`, `height`
- `checksum_sha256`
- `status`: `active`, `deleted` hoặc `orphaned`
- `uploaded_by`, `created_at`, `deleted_at`

Alt text theo ngôn ngữ nằm trong nội dung sử dụng media, vì cùng một ảnh có thể cần mô tả khác nhau tùy ngữ cảnh.

### `redirects`

- `id`
- `locale`
- `old_path`
- `new_path`
- `created_by`, `created_at`

`old_path` duy nhất. Không cho tạo chuỗi redirect vòng lặp hoặc redirect tới route quản trị.

### `audit_events`

- `id`
- `actor_user_id`
- `action`
- `resource_type`, `resource_id`
- `metadata_json`
- `request_id`
- `created_at`

Audit không lưu JWT, cookie, secret hoặc toàn bộ nội dung nhạy cảm.

## 6. Nội dung đa ngôn ngữ và workflow

Một `content_item` đại diện cho cùng một nội dung ở cả ba ngôn ngữ. Trang quản trị hiển thị VI, EN và JA dưới dạng ba tab. Slug và media chính được dùng chung; dữ liệu văn bản và SEO nằm trong từng locale.

Luồng chuẩn:

1. Editor hoặc Admin mở một locale.
2. Người dùng sửa và nhấn **Lưu bản nháp**.
3. API kiểm tra schema, quyền và `draft_version` trước khi lưu.
4. Preview render trực tiếp từ `draft_data_json` qua route được Access bảo vệ.
5. Admin nhấn **Xuất bản**.
6. D1 batch/transaction tạo revision, cập nhật `published_revision_id` và ghi audit event như một đơn vị nguyên tử.
7. Cache của trang, danh sách Insights liên quan, homepage liên quan và sitemap được làm mới.

Xuất bản một locale không thay đổi hai locale còn lại. Khi locale đã có nội dung công khai nhưng bản nháp mới chưa hoàn tất, khách vẫn thấy revision đã xuất bản gần nhất.

Nếu homepage của một locale chưa từng được xuất bản, hệ thống trả trang tối thiểu với HTTP 200, thông tin thương hiệu và liên hệ cơ bản được đóng gói cùng ứng dụng. Một Insight chưa từng xuất bản phải trả HTTP 404 và không xuất hiện trong sitemap, danh sách bài hoặc liên kết alternate.

## 7. Giao diện quản trị

Trang `/admin` gồm:

- Dashboard: nháp đang mở, locale còn thiếu, lần xuất bản gần nhất và audit gần đây.
- Nội dung: Homepage, Insights và Settings.
- Media: upload, tìm kiếm, preview, chọn và xem nơi đang sử dụng.
- Người dùng: chỉ Admin truy cập.

Biểu mẫu Homepage dùng các nhóm trường cố định tương ứng menu, hero, giới thiệu, năng lực, sản phẩm, Insights, liên hệ và footer. Insight gồm tiêu đề, mô tả, nội dung, tác giả, ngày hiển thị, ảnh và SEO. Settings gồm tên doanh nghiệp, URL chuẩn, ảnh chia sẻ mặc định và thông tin thương hiệu.

Yêu cầu UX:

- Hiển thị trạng thái Draft/Published và thời gian sửa/xuất bản theo locale.
- Cảnh báo khi rời trang có thay đổi chưa lưu.
- Hiển thị lỗi validation cạnh đúng trường.
- Khi `draft_version` xung đột, không ghi đè; yêu cầu tải lại hoặc sao chép nội dung đang nhập.
- Preview mở route riêng và luôn có `noindex`.
- Không autosave trong phiên bản đầu tiên; người dùng chủ động nhấn **Lưu bản nháp**.

## 8. Media và R2

File gốc được upload qua Worker. Phiên bản đầu tiên chấp nhận JPEG, PNG, WebP và AVIF tối đa 20 MiB mỗi ảnh; PDF tối đa 25 MiB mỗi file. Ảnh không được vượt quá 12.000 x 12.000 pixel. SVG do người dùng tải lên bị từ chối vì có thể chứa nội dung thực thi; SVG đóng gói cùng mã nguồn vẫn được phép sau code review. Worker kiểm tra quyền, dung lượng, MIME sniffing, kích thước ảnh và định dạng thực tế trước khi ghi R2. Tên file do người dùng cung cấp chỉ dùng làm metadata; `r2_key` dùng UUID hoặc content hash và không cho phép path traversal.

Sau khi R2 ghi thành công, Worker ghi metadata D1. Nếu ghi D1 thất bại, file được đánh dấu/dọn như orphan; nếu R2 thất bại thì không tạo metadata. Media đang được nội dung nháp hoặc revision sử dụng không được xóa.

Cloudflare Workers Images binding tạo các biến thể kích thước cần thiết và xuất AVIF/WebP khi trình duyệt hỗ trợ. Biến thể được cache ở edge. File R2 gốc không public trực tiếp. Nếu transformation thất bại, route media trả file gốc hợp lệ với giới hạn an toàn thay vì ảnh hỏng.

Media dùng khóa bất biến và cache một năm với `immutable`. Thay ảnh tạo media ID mới; không ghi đè object đang được cache. Xóa là soft delete trước. Cloudflare Cron Trigger chạy hằng ngày và chỉ dọn object đã bị xóa mềm ít nhất 30 ngày, không còn tham chiếu từ draft hay revision và vẫn khớp checksum trong metadata.

## 9. SSR, cache và hiệu lực xuất bản

Astro SSR chỉ đọc revision được `published_revision_id` trỏ tới cho request công khai. Không có API công khai nào trả `draft_data_json`.

HTML công khai dùng `CDN-Cache-Control: public, s-maxage=60, stale-while-revalidate=300`; cache trình duyệt có thể ngắn hơn hoặc `no-cache`. Khi publish, Worker yêu cầu purge chính xác các URL bị ảnh hưởng thông qua Cloudflare API bằng token có quyền purge tối thiểu được lưu dưới dạng Worker secret. Các URL gồm trang vừa xuất bản, trang danh sách Insights của locale, homepage nếu có preview bài và sitemap.

Publish D1 không rollback chỉ vì purge cache thất bại. API trả trạng thái “đã xuất bản, đang làm mới cache”, ghi audit/error với request ID, và TTL ngắn bảo đảm nội dung cũ tự hết hạn. Không hiển thị bản nháp để thay thế cache cũ.

Media bất biến dùng cache dài hạn. Preview và admin gửi `Cache-Control: private, no-store`.

## 10. SEO và URL

Mỗi locale có title, description, canonical URL và ảnh chia sẻ riêng. Astro tạo:

- `hreflang` cho các locale đã xuất bản và `x-default` phù hợp.
- Open Graph và Twitter Card.
- JSON-LD cho Organization, WebSite và Article.
- Sitemap chỉ gồm URL đã xuất bản.
- Robots rules chặn admin, API và preview.

Slug dùng chung cho nhóm bản dịch. Khi đổi slug, hệ thống kiểm tra xung đột, tạo redirect 301 cho từng locale có URL cũ và cập nhật link nội bộ. Không tự động xóa redirect cũ.

Việc nhập nội dung thủ công không bảo đảm URL cũ được giữ. Giao diện phải cho người nhập sử dụng lại slug cũ, và báo cáo 404 sau cutover được dùng để bổ sung redirect cần thiết.

## 11. Triển khai và cấu hình Cloudflare

Production gồm:

- Một Cloudflare Worker chạy Astro.
- Một D1 database production.
- Một R2 bucket production.
- Workers Images binding.
- Cloudflare Access application/policies cho admin, API admin và preview.
- Custom domain `tnchandicraft.com` và DNS trên Cloudflare.
- Workers Builds kết nối repository GitHub.

Local development dùng Wrangler với D1/R2 local. Binding local và production phải có tên giao diện giống nhau nhưng tài nguyên riêng. Secret, Access audience, cache purge token và thông tin tài khoản không được commit.

D1 migration được version hóa trong repository. Thay đổi schema không tương thích phải triển khai theo mô hình expand/migrate/contract để deployment trước và sau có thể cùng hoạt động trong thời gian chuyển đổi.

Workflow GitHub Pages hiện tại chỉ được vô hiệu hóa hoặc xóa trong giai đoạn cutover sau khi Worker production đã vượt qua kiểm thử. Không triển khai Worker production hoặc đổi DNS chỉ dựa trên build thành công ở local.

## 12. Xử lý lỗi và khả năng phục hồi

- Lưu nháp thất bại giữ nguyên dữ liệu trong trình duyệt và cho phép thử lại.
- Publish dùng D1 batch/transaction cho revision, con trỏ published và audit event.
- Request quản trị có request ID; log không chứa token hoặc dữ liệu nhạy cảm.
- Lỗi production trả thông báo an toàn, không trả stack trace.
- D1 lỗi tạm thời ưu tiên nội dung edge cache còn hợp lệ.
- Upload lỗi giữa R2 và D1 được phát hiện và dọn orphan.
- Rollback nội dung dùng revision; rollback ứng dụng dùng deployment trước của Cloudflare.
- D1 bật khả năng khôi phục theo thời điểm của Cloudflare. Hằng tuần, quy trình vận hành đã tài liệu hóa xuất D1 và danh mục object R2 vào vùng backup R2 tách biệt; giữ ít nhất bốn bản tuần gần nhất. Restore rehearsal được chạy trước cutover và sau mọi thay đổi schema lớn.

## 13. Kiểm thử

### Unit

- Schema nội dung theo từng type và locale.
- Quyền Admin/Editor.
- Chuyển trạng thái draft, publish và restore.
- Tạo redirect và ngăn vòng lặp.
- Tính các URL cần purge cache.

### Integration

- D1 migrations trên database mới.
- Draft -> preview -> publish -> sửa draft -> restore revision.
- Publish độc lập cho VI/EN/JA.
- Upload R2, ghi metadata, phát hiện orphan và chặn xóa media đang dùng.
- Access identity mapping và người dùng bị khóa.

### End-to-end

- Website công khai ở ba ngôn ngữ.
- Editor không thể publish hoặc quản lý user.
- Admin có thể publish và restore.
- Request không xác thực không vào được admin, API admin hoặc preview.
- Sitemap, canonical, hreflang, JSON-LD và redirect 301.
- Nội dung nháp không xuất hiện trên website hoặc public response.
- Accessibility cơ bản cho website và form quản trị.

Build production, migration rehearsal và smoke test trên hostname Worker phải hoàn tất trước cutover.

## 14. Cutover trực tiếp

1. Tạo D1, R2, Images binding, Worker và Access policies.
2. Chạy migrations và bootstrap Admin đầu tiên.
3. Deploy ứng dụng lên hostname thử nghiệm của Worker.
4. Kiểm thử authentication, role, draft, preview, publish, revision, media và SEO.
5. Tạo homepage tối thiểu cho ba locale; chưa tạo Insight giả.
6. Gắn `tnchandicraft.com` vào Worker và ngừng deploy GitHub Pages.
7. Nhập nội dung thủ công và xuất bản từng locale.
8. Theo dõi error log, cache, 404 và Core Web Vitals; bổ sung redirect cần thiết.

Cutover được coi là thành công khi custom domain phục vụ Worker qua HTTPS, admin được Access bảo vệ, nội dung công khai không đọc được draft, homepage ba locale hoạt động, và quy trình draft/preview/publish đã được kiểm thử trên production.

## 15. Tiêu chí nghiệm thu

- Hugo và Decap không còn cần thiết cho runtime hoặc quản trị nội dung.
- GitHub Pages không còn phục vụ tên miền production.
- Astro SSR chạy ổn định trên Cloudflare Workers.
- D1/R2/Access hoạt động theo đúng ranh giới quyền đã thiết kế.
- Admin và Editor có đúng quyền.
- Nội dung ba ngôn ngữ được quản lý trong cùng một item nhưng xuất bản độc lập.
- Revision có thể được khôi phục thành nháp mà không thay đổi production ngay lập tức.
- Media không public trực tiếp từ R2 và không thể xóa khi đang được tham chiếu.
- Preview/admin không cache công khai và không được lập chỉ mục.
- Sitemap và metadata chỉ phản ánh nội dung đã xuất bản.
- Có kiểm thử tự động cho các luồng bảo mật và xuất bản quan trọng.
