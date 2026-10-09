# TNC Handicraft — Astro CMS on Cloudflare

Ứng dụng mới dùng Astro SSR trên Cloudflare Workers, D1 cho nội dung và tài khoản CMS, R2 cho media, cùng Cloudflare Access để bảo vệ `/admin`, `/api/admin` và `/preview`.

## Phát triển local

Yêu cầu Node.js 24. Cài đúng dependency đã khóa và khởi tạo D1 local:

```bash
npm ci
npm run db:migrate:local
npm run worker:dev
```

Worker chạy tại `http://127.0.0.1:8787`. Website công khai có các route `/vi/`, `/en/`, `/ja/`; dữ liệu local nằm trong state của Wrangler và media nằm trong R2 local.

Không dùng Hugo hoặc Decap cho phát triển mới. Các file Hugo cũ chỉ được giữ tạm thời để rollback cho đến khi cutover production được xác nhận.

## Kiểm tra

```bash
npm run check
npm test
npm run test:e2e
npm run verify
```

`npm run verify` chạy type check, unit, integration, browser E2E và production build. Các E2E quản trị chỉ chạy khi có JWT Cloudflare Access ký cho môi trường local:

- `E2E_ACCESS_JWT` và `E2E_EDITOR_ITEM_ID` cho Editor.
- `E2E_ADMIN_ACCESS_JWT` cho Admin.

Không có auth bypass dành cho local. CI không có credential thật nên vẫn chạy các E2E công khai và báo riêng các kịch bản quản trị bị skip.

## Nhập nội dung thủ công

1. Mời email trong `/admin/users/` với vai trò Admin hoặc Editor.
2. Thêm cùng email đó vào policy của ứng dụng trong Cloudflare Zero Trust; lời mời D1 không tự thay đổi Access policy.
3. Tạo nội dung tại `/admin/content/`, nhập riêng VI/EN/JA và lưu nháp.
4. Chọn ảnh từ `/admin/media/`; alt text được nhập riêng theo từng locale.
5. Mở Preview để kiểm tra. Chỉ Admin có thể Publish hoặc Restore revision; Restore chỉ tạo draft và cần Publish riêng.

## Cấu hình Cloudflare

`wrangler.jsonc` định nghĩa Worker, D1, R2 và Cron dọn media. Giá trị production và secret không được commit; xem runbook triển khai trước khi tạo resource hoặc đổi DNS.

Thư mục public của Astro là `astro-public/`. `static/`, `content/`, `layouts/` và workflow Hugo là di sản rollback, không thuộc runtime Astro.
