# Astro + Cloudflare Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay Hugo/Decap bằng Astro SSR và CMS có cấu trúc trên Workers, D1, R2 và Access, giữ ba ngôn ngữ và workflow draft → preview → publish.

**Architecture:** Một Astro Worker gồm website công khai, admin và API, với module riêng cho auth, content, media và cache. Revision bất biến là nguồn duy nhất của nội dung công khai; Access xác thực và D1 quyết định quyền. Nội dung nhập thủ công, cutover diễn ra sau kiểm thử với homepage tối thiểu.

**Tech Stack:** Astro, TypeScript strict, @astrojs/cloudflare, Wrangler, D1, R2, Workers Images, Access; Zod, jose, unified/remark/rehype; Vitest với Cloudflare Workers pool, Playwright và axe-core.

**Spec:** [Đặc tả đã duyệt](../specs/2026-10-09-astro-cloudflare-migration-design.md)

## Global Constraints

- Repository: `/workspace/tnc`, baseline `6576fe4`; working tree sạch tại thời điểm lập kế hoạch. Dùng checkout cloud hiện tại; không tạo worktree trừ khi người dùng yêu cầu.
- Một Worker; route public `/vi/*`, `/en/*`, `/ja/*`; admin `/admin/*`, API `/api/admin/*`, preview `/preview/*`.
- Vai trò `admin` và `editor`; Editor không publish, restore, quản lý users hoặc xóa media.
- Không nhập tự động Markdown/YAML cũ; không tạo Insight giả. Chỉ dùng nội dung fallback thương hiệu tối thiểu.
- Homepage và settings là singleton; một item chứa ba locale, publish từng locale độc lập.
- Restore tạo draft mới, không đổi published pointer; draft_version chống ghi đè.
- JPEG/PNG/WebP/AVIF: tối đa 20 MiB; PDF: tối đa 25 MiB; ảnh không vượt 12.000 x 12.000 pixel. Từ chối SVG upload.
- Media cache một năm với `immutable`; Cron hằng ngày chỉ dọn file soft-delete ít nhất 30 ngày, không tham chiếu và checksum khớp.
- HTML: `CDN-Cache-Control: public, s-maxage=60, stale-while-revalidate=300`; private routes: `Cache-Control: private, no-store`.
- Cache purge lỗi không rollback publish; API báo “đã xuất bản, đang làm mới cache”.
- Không commit secret, JWT, email Admin thật hoặc ID tài nguyên production. Kiểm tra bindings có sẵn trước khi yêu cầu cấu hình.
- Chỉ ngừng GitHub Pages sau smoke test production; DNS/cutover dùng cấu hình production đã kiểm tra.
- Không lưu mật khẩu. D1 Time Travel, backup D1 và danh mục R2 hằng tuần, giữ bốn bản; rehearsal trước cutover và sau schema change lớn.

## Review Focus

1. Sửa slug/ảnh dùng chung khi một locale còn nháp: revision công khai và hai locale khác không bị đổi — Tasks 4–6.
2. Hai người cùng lưu/publish và hai Admin cùng đổi quyền: chỉ một thay đổi hợp lệ, không mất draft hoặc Admin cuối — Tasks 3–5, 12.
3. HTML/Markdown/URL độc hại và request giả origin: không XSS, CSRF hoặc Access bypass — Tasks 3, 7, 10–12.
4. Upload chỉ được dùng trong draft nhưng URL media bị đoán: người chưa đăng nhập không lấy được file; public cache không lưu response riêng tư — Tasks 8–9.
5. D1 commit thành công nhưng purge/R2/backup thất bại: không báo mất nội dung, không xóa nhầm file và có khả năng phục hồi — Tasks 6, 8–9, 14–15.

---

## Ranh giới bàn giao và bản đồ tệp

Đây là các phần phụ thuộc chặt vào cùng dữ liệu, không phải các dự án độc lập. Dùng một kế hoạch tuần tự; mỗi task có deliverable kiểm thử được và một commit riêng.

| Phần | Tệp chịu trách nhiệm |
| --- | --- |
| Runtime/tooling | `package.json`, `package-lock.json`, `astro.config.mjs`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `playwright.config.ts`, `src/env.d.ts` |
| Auth/HTTP | `src/middleware.ts`, `src/server/auth/{access,users,policy}.ts`, `src/server/http/{errors,csrf}.ts` |
| Nội dung | `migrations/*.sql`, `src/server/content/{types,schema,repository,drafts,publish,restore,routes}.ts`, `src/server/audit.ts` |
| Render/SEO/cache | `src/components/site/*.astro`, `src/layouts/SiteLayout.astro`, `src/server/site/{queries,fallback,markdown,seo,cache}.ts` |
| Media | `src/server/media/{validate,repository,upload,serve,cleanup}.ts`, `src/pages/media/[id].ts` |
| Admin/API | `src/components/admin/*.astro`, `src/client/admin/*.ts`, `src/pages/admin/**`, `src/pages/api/admin/**`, `src/pages/preview/[id]/[locale].astro` |
| Operations | `src/worker.ts`, `scripts/{bootstrap-admin,backup,restore-rehearsal,smoke-production}.ts`, `docs/operations/{cloudflare,cutover,backup}.md` |
| Tests | `tests/unit/**`, `tests/integration/**`, `tests/e2e/**`, `tests/helpers/{fixtures,access-jwt,database}.ts` |

CSS hiện tại ở `static/styles.css`, JS ở `static/script.js`; layout tham khảo từ `layouts/**`, field mapping từ `static/admin/config.yml` và `content/*/_index.md`. Chỉ chuyển cấu trúc và giao diện, không copy nội dung cũ vào D1. Hugo, các HTML đã build ở root và OAuth Worker giữ nguyên trong thời gian phát triển; Task 16 dọn sau cutover.

## Giao diện chung và quy tắc dữ liệu

Task 2 định nghĩa/export trong `src/server/content/types.ts`:

- `Locale = 'vi' | 'en' | 'ja'`, `ContentType = 'homepage' | 'insight' | 'settings'`, `Role = 'admin' | 'editor'`.
- `Actor = { id: string; subject: string; email: string; role: Role }`.
- `Seo = { title: string; description: string; image: MediaRef | null }`.
- `MediaRef = { mediaId: string; alt: string }`.
- `HomepageData`: giữ cây field nav, hero, about, capabilities, products, insights, contact, footer của CMS hiện tại, thêm seo; schema camelCase.
- `InsightData = { title: string; description: string; bodyMarkdown: string; author: string; displayDate: string; seo: Seo }`.
- `SettingsData = { siteName: string; companyName: string; tagline: string; seo: Seo }`.
- `SharedData = { primaryMediaId: string | null }`.
- `LocaleData = HomepageData | InsightData | SettingsData`.
- `Snapshot = { type: ContentType; slug: string; shared: SharedData; data: LocaleData }`.
- `Draft = { itemId: string; locale: Locale; version: number; sharedVersion: number; snapshot: Snapshot; publishedRevisionId: string | null }`.
- `Published = { itemId: string; locale: Locale; revisionId: string; publishedAt: string; snapshot: Snapshot }`.
- `AppEnv` định nghĩa ở Task 1 trong `src/env.d.ts`: bindings `DB: D1Database`, `MEDIA: R2Bucket`, `IMAGES: ImagesBinding`; config strings `ACCESS_ISSUER`, `ACCESS_AUDIENCE`, `SITE_ORIGIN`, `CLOUDFLARE_ZONE_ID`, `CACHE_PURGE_TOKEN` lấy từ runtime config, không dùng giá trị hard-code production.
- Lỗi ứng dụng: `AppError(code, status, message, fields?)`; JSON lỗi `{ error: { code, message, fields? }, requestId }`. Không trả stack trace.

Không đọc `content_items.slug/shared_data_json` để render public. Snapshot revision chứa cả dữ liệu chung và locale. Thêm bảng phụ `published_routes` để giữ path hiện hành từng locale, và `media_references` để kiểm tra draft/revision dùng file; đây là index phục vụ các yêu cầu trong spec.

Mỗi LocaleData còn có `primaryMediaAlt: string` cho ảnh dùng chung. Task 2 export `collectMediaIds(snapshot: Snapshot): string[]` trong schema.ts: tìm MediaRef, shared primaryMediaId và Markdown image links nội bộ; file id lặp chỉ ghi một reference.

Test snippets bên dưới dùng fixtures của Task 2 và Vitest; các biến db/env/actor/itemId cùng test data được setup trong từng test file, không dùng dữ liệu production. Các assertion tiêu biểu là yêu cầu tối thiểu, cùng toàn bộ cases liệt kê trong bước test. Test harness đầu tiên có thể được thêm trước vòng red/green; thất bại phải do hành vi thiếu, không do npm chưa cài hoặc runner chưa cấu hình.

### Lệnh kiểm chứng theo task

Các bước “chạy tests” ở từng task dùng lệnh tương ứng dưới đây. Trước implementation, case mới phải FAIL do thiếu hành vi; sau implementation tất cả case mục tiêu PASS và thực sự chạy ít nhất một test.

| Task | Lệnh |
| --- | --- |
| 1 | `npm run test:integration -- tests/integration/runtime.test.ts` |
| 2 | `npm run test:unit -- tests/unit/content-schema.test.ts`; `npm run test:integration -- tests/integration/migrations.test.ts` |
| 3 | `npm run test:integration -- tests/integration/auth.test.ts tests/integration/runtime.test.ts` |
| 4 | `npm run test:integration -- tests/integration/drafts.test.ts` |
| 5 | `npm run test:integration -- tests/integration/publishing.test.ts tests/integration/drafts.test.ts` |
| 6 | `npm run test:unit -- tests/unit/cache.test.ts`; `npm run test:integration -- tests/integration/public-content.test.ts` |
| 7 | `npm run test:unit -- tests/unit/markdown.test.ts`; `npm run test:integration -- tests/integration/site.test.ts` |
| 8 | `npm run test:integration -- tests/integration/media-upload.test.ts` |
| 9 | `npm run test:integration -- tests/integration/media-serving.test.ts tests/integration/media-cleanup.test.ts` |
| 10 | `npm run test:integration -- tests/integration/admin-api.test.ts` |
| 11 | `npm run test:e2e -- tests/e2e/editor.spec.ts` |
| 12 | `npm run test:integration -- tests/integration/users.test.ts`; `npm run test:e2e -- tests/e2e/admin-management.spec.ts` |
| 13 | `npm run verify`; `npx wrangler deploy --dry-run` |
| 14 | `npm run test:integration -- tests/integration/operations.test.ts`; `npm run restore:rehearsal -- --local` |
| 15 | `npm run smoke:production -- --origin <worker-test-host>`; browser Access login + two-edge cache checks trong runbook |
| 16 | `npm run verify`; `npm run smoke:production -- --origin https://tnchandicraft.com` |

## Task 1: Runtime Astro chạy được trên Workers local

**Files:** Create tooling files trong bảng trên, `.node-version`, `src/pages/index.astro`, `tests/integration/runtime.test.ts`. Modify `.gitignore`, `README.md`.

**Interfaces:** Produces `AppEnv` và Astro locals typed; npm scripts `dev`, `build`, `check`, `test:unit`, `test:integration`, `test:e2e`, `db:migrate:local`, `worker:dev`. `/` redirect 302 về `/vi/`.

- [ ] Đọc tài liệu Astro Cloudflare adapter và Wrangler hiện hành; xác định bộ phiên bản tương thích Node 24. Pin exact phiên bản package và lockfile, không dùng latest trong script. Xác định entry build thực tế của adapter trước khi cấu hình Wrangler.
- [ ] Tạo test harness và test runtime: request `/` trả 302 với `Location: /vi/`; binding DB/R2 local tồn tại; build assets không phục vụ các HTML Hugo/Decap cũ.

Assertion tiêu biểu:

```ts
test('root_redirects_to_vi', async () => {
  const response = await SELF.fetch('https://site.test/', { redirect: 'manual' });
  expect(response.status).toBe(302);
  expect(response.headers.get('Location')).toBe('/vi/');
});
```
- [ ] Chạy `npm run test:integration -- tests/integration/runtime.test.ts`; phải FAIL do app chưa có route/bindings.
- [ ] Tạo Astro SSR config và local Wrangler không chứa production ID; asset directory riêng, không copy toàn bộ `static/` hoặc HTML root. Ignore node_modules, dist, .astro, .wrangler, .dev.vars, reports.
- [ ] Chạy `npm run check && npm run build`, runtime test và smoke request qua Wrangler local. Entry/asset config phải đúng output thực tế. Chưa deploy.
- [ ] Commit các tệp Task 1 với message `feat: initialize Astro Workers runtime`.

## Task 2: Schema nội dung và database mới

**Files:** Create `migrations/0001_cms.sql`, `src/server/content/{types,schema}.ts`, `tests/helpers/{fixtures,database}.ts`, `tests/unit/content-schema.test.ts`, `tests/integration/migrations.test.ts`.

**Interfaces:** Produces types ở mục chung; `validateSnapshot(type: ContentType, input: unknown): Snapshot`; fixtures `makeHomepage(): Snapshot`, `makeInsight(): Snapshot`, `makeSettings(): Snapshot`, `makeActor(role: Role): Actor`. Helpers `resetDatabase(): Promise<void>`, `seedActor(actor: Actor): Promise<void>`.

- [ ] Viết tests: locale ngoài vi/en/ja bị từ chối; title trống không publish; slug chuẩn ASCII lowercase kebab-case tối đa 120 ký tự; title tối đa 200, description 500, bodyMarkdown 200.000; unknown JSON fields bị từ chối.

Assertion tiêu biểu:

```ts
test('rejects_invalid_slug', () => {
  expect(() => validateSnapshot('insight', { ...makeInsight(), slug: '../admin' })).toThrow();
});
```
- [ ] Test migrations trên DB trống: đủ bảng spec và index phụ, unique locale/item và singleton, foreign key, role/type/locale CHECK; migration chạy lần hai không mất dữ liệu.
- [ ] Chạy unit/integration files trên; xác nhận FAIL trước migration/schema.
- [ ] Implement Zod schema; homepage ánh xạ toàn bộ cây field CMS hiện tại; collection list tối đa 100 phần tử. URL cho phép path nội bộ/hash và https; không javascript/data. Production origin từ config trusted; Settings không cho Editor thay hostname.
- [ ] Implement tables spec, thêm `content_items.shared_version`, `content_locales.draft_source_revision_id`, snapshot trong revision; `published_routes(locale,path,item_id,revision_id)`; `media_references(media_id,owner_kind,owner_id)`. Access subject nullable cho user mới được mời, unique khi đã liên kết. Revision dùng trigger chặn UPDATE/DELETE.
- [ ] Chạy `npm run db:migrate:local` và hai test files; tất cả PASS. Commit `feat: add CMS schemas and D1 migrations`.

## Task 3: Access JWT, vai trò và bảo vệ request

**Files:** Create `src/server/auth/{access,users,policy}.ts`, `src/server/http/{csrf,errors}.ts`, `src/server/audit.ts`, `src/middleware.ts`, `tests/helpers/access-jwt.ts`, `tests/integration/auth.test.ts`.

**Interfaces:** Consumes AppEnv/Actor. Produces `authenticate(request: Request, env: AppEnv): Promise<Actor>`, `requireRole(actor: Actor, role: Role): void`, `requireSameOrigin(request: Request, trustedOrigin: string): void`, `writeAudit(db: D1Database, actor: Actor, action: string, resourceId: string, requestId: string): Promise<void>`.

- [ ] Tests dùng JWT ký bằng key test và mocked JWKS, không header email giả: missing/signature sai/issuer sai/audience sai/expired → 401; user chưa được mời/disabled → 403; editor publish → 403.

Assertion tiêu biểu:

```ts
test('editor_cannot_publish', () => {
  expect(() => requireRole(makeActor('editor'), 'admin')).toThrow();
});
```
- [ ] Tests cho exact `/admin`, `/admin/`, `/api/admin`, subpaths và `/preview`; mọi method đều xác thực. Cross-origin POST/PUT/DELETE → 403; valid origin nhưng JWT sai vẫn 401.
- [ ] Chạy auth test, phải FAIL. Test runtime public root vẫn không bị yêu cầu JWT.
- [ ] Implement jose verify với issuer/audience cố định từ config, JWKS cache có timeout; lấy subject từ JWT. First login liên kết subject cho email đã mời bằng atomic conditional update, sau đó không email-remap subject khác.
- [ ] Middleware đặt actor vào locals, kiểm tra D1 active mỗi request; private routes no-store/noindex/Vary phù hợp; unsafe methods yêu cầu trusted Origin. API error có request ID, log redacted. Test signing keys chỉ ở tests, production không có auth bypass.
- [ ] Chạy auth/runtime integration tests; xác nhận lỗi không chứa token/stack. Commit `feat: protect CMS routes with Cloudflare Access`.

## Task 4: Tạo nội dung và lưu nháp chống xung đột

**Files:** Create `src/server/content/{repository,drafts}.ts`, `tests/integration/drafts.test.ts`.

**Interfaces:** Consumes Snapshot/Draft/Actor. Produces `createItem(db, actor, type, slug): Promise<string>`, `getDraft(db, itemId, locale): Promise<Draft>`, `saveDraft(db, actor, itemId, locale, expectedVersion, data): Promise<Draft>`, `saveShared(db, actor, itemId, expectedSharedVersion, shared): Promise<number>`. Tham số db: D1Database, itemId/slug: string, locale: Locale, versions: number, data: LocaleData, shared: SharedData.

- [ ] Tests: item mới có ba locale; unique slug/singleton; save VI không đổi EN/JA; concurrent saves cùng version chỉ một thắng và một 409; Editor sửa shared media không làm thay đổi public.

Assertion tiêu biểu:

```ts
test('stale_draft_version_is_rejected', async () => {
  await saveDraft(db, actor, itemId, 'vi', 1, makeInsight().data);
  await expect(saveDraft(db, actor, itemId, 'vi', 1, makeInsight().data)).rejects.toMatchObject({ status: 409 });
});
```
- [ ] Chạy `npm run test:integration -- tests/integration/drafts.test.ts`; phải FAIL.
- [ ] Implement prepared statements, validation và CAS update; audit cùng batch. Shared data là draft chung có version riêng, snapshot được tạo chỉ khi publish. Không implicit publish khi save.
- [ ] Đồng bộ media_references draft trong batch, không cho tham chiếu file thiếu/deleted; liệt kê draft status/last editor/time cho dashboard.
- [ ] Chạy tests, kiểm tra audit không ghi payload lớn. Commit `feat: add versioned drafts and shared content`.

## Task 5: Publish nguyên tử và restore revision

**Files:** Create `src/server/content/{publish,restore,routes}.ts`, `tests/integration/publishing.test.ts`.

**Interfaces:** Produces `publishLocale(db, actor, itemId, locale, expectedVersion, expectedSharedVersion): Promise<{ revisionId: string; affectedPaths: string[] }>`, `restoreRevision(db, actor, itemId, locale, revisionId, expectedVersion, expectedSharedVersion): Promise<Draft>`, `saveItemMetadata(db, actor, itemId, expectedSharedVersion, slug, shared): Promise<number>`. db: D1Database; ids/slug: string; locale: Locale; shared: SharedData; expected versions: number.

- [ ] Tests publish VI tạo revision/pointer/audit đúng; EN/JA giữ bản cũ; lỗi audit khiến cả batch rollback; Editor bị từ chối. Hai publish cùng expected version không tạo hai revision.

Assertion tiêu biểu:

```ts
test('editor_cannot_publish_revision', async () => {
  await expect(publishLocale(db, makeActor('editor'), itemId, 'vi', 1, 1)).rejects.toMatchObject({ status: 403 });
});
```
- [ ] Tests restore chỉ tạo draft mới và source_revision_id; revision immutable; dùng revision của item/locale khác → 404/409. Shared image/slug draft mới không lọt vào public snapshot.
- [ ] Tests slug đổi chỉ hiệu lực khi locale đó publish; redirect A→B→C đưa A/B thẳng tới C, không loop; slug chưa publish của VI không xóa route cũ EN.
- [ ] Chạy publishing tests; phải FAIL.
- [ ] Implement D1 batch với CAS guard bảo đảm lỗi precondition abort toàn bộ batch, revision_number unique và increment draft version sau publish. Dùng sqlite constraint/guard statement, không read rồi write độc lập; thử trực tiếp D1 local.
- [ ] Batch cập nhật published_routes, snapshot shared+local, references revision và redirects. Restore không ghi published_routes. Update draft shared khi restore dùng shared_version, báo conflict thay vì ghi đè thay đổi mới. saveItemMetadata cập nhật slug và shared trong một CAS, không ghép hai lần tăng version.
- [ ] Chạy drafts/publishing tests; commit `feat: publish locale revisions atomically`.

## Task 6: Đọc public và cache sau publish

**Files:** Create `src/server/site/{queries,cache}.ts`, `tests/integration/public-content.test.ts`, `tests/unit/cache.test.ts`.

**Interfaces:** `getPublished(db, locale, path): Promise<Published | null>`, `listPublished(db, locale): Promise<Published[]>`, `resolveRedirect(db, locale, path): Promise<string | null>`; `purgePublished(env, paths: string[]): Promise<'purged' | 'pending'>`; `publicCacheHeaders(): Headers`. locale: Locale; db: D1Database; path: string.

- [ ] Tests public queries không chứa draft; revision snapshot giữ ảnh/slug cũ; settings cùng locale có thể publish riêng. Cache headers đúng literal spec; private responses không cache.

Assertion tiêu biểu:

```ts
test('html_cache_header_matches_spec', () => {
  expect(publicCacheHeaders().get('CDN-Cache-Control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
});
```
- [ ] Tests affectedPaths đủ article, list, homepage, sitemap, old/new path khi đổi slug và alternate metadata locale khác; purge 403/timeout → pending nhưng revision vẫn published.
- [ ] Chạy hai test files; phải FAIL.
- [ ] Implement prepared joins chỉ published pointers; cache key canonical origin/path không query tùy ý. Worker Cache API cache public GET/200 không cookie; tuyệt đối không rely vào header HTML để mặc nhiên có edge cache.
- [ ] Implement purge bằng scoped token qua Cloudflare zone API, timeout 5s, audit pending. Key Cache API phải khớp URL purge; global invalidation cần chứng minh Task 15. Không cache 401/403/404/preview. Serve stale chỉ public response tối đa 300s sau TTL khi D1 lỗi; không refresh stale age khi fetch lỗi.
- [ ] Chạy queries/cache tests; commit `feat: read published content and invalidate cache`.

## Task 7: Giao diện Astro ba ngôn ngữ và SEO

**Files:** Create `src/layouts/SiteLayout.astro`, `src/components/site/{Header,Footer,Homepage,InsightCard,InsightArticle,SeoHead}.astro`, `src/server/site/{fallback,markdown,seo}.ts`, `src/pages/[locale]/index.astro`, `src/pages/[locale]/insights/{index,[slug]}.astro`, `src/pages/{sitemap.xml,robots.txt}.ts`, `src/pages/404.astro`, `src/styles/site.css`, `src/client/site.ts`, `public/images/og-default.svg`, `tests/integration/site.test.ts`, `tests/unit/markdown.test.ts`.

**Interfaces:** Consumes getPublished/listPublished. Produces `fallbackHomepage(locale: Locale): HomepageData`, `renderMarkdown(markdown: string): Promise<string>`, `buildSeo(content: Published, alternates: Published[], origin: string): SeoView`; `SeoView` defined/exported in seo.ts contains canonical/alternates/OG/Twitter/JSON-LD.

- [ ] Tests 3 homepage fallback 200, unpublished article 404, published article 200; sitemap không draft; alternates chỉ locale đã publish; unsupported locale 404.

Assertion tiêu biểu:

```ts
test('markdown_drops_script', async () => {
  const html = await renderMarkdown('<script>alert(1)</script>');
  expect(html).not.toContain('<script');
});
```
- [ ] Tests Markdown `<script>`, onerror, javascript link và JSON-LD `</script>` không thực thi; internal image reference `/media/<id>` render an toàn; 301 dùng routes đã publish.
- [ ] Chạy site/markdown tests; phải FAIL.
- [ ] Port CSS/layout từ Hugo; fallback chỉ tên thương hiệu và thông báo nội dung đang cập nhật theo locale, không bịa email/address. Insight bodyMarkdown qua remark/rehype sanitize; raw HTML không trusted.
- [ ] SeoHead escape JSON-LD; root x-default về /, articles chọn VI nếu có hoặc locale published đầu tiên; homepage fallback không tính là nội dung published trong sitemap. Metadata Insights list dùng settings hoặc fallback hợp lệ.
- [ ] Render bài dùng settings/homepage nav/footer thay vì giả định Insight chứa chúng. Apply cache từ Task 6, lỗi public 503 khi không có stale cache và D1 không đọc được.
- [ ] Chạy tests, `npm run check && npm run build`; commit `feat: render multilingual Astro site and SEO`.

## Task 8: Upload media và chỉ mục tham chiếu

**Files:** Create `src/server/media/{validate,repository,upload}.ts`, `src/pages/api/admin/media/index.ts`, `tests/integration/media-upload.test.ts`.

**Interfaces:** `uploadMedia(env: AppEnv, actor: Actor, file: File): Promise<MediaRecord>`; `MediaRecord` exported repository.ts, fields theo spec; consumes collectMediaIds từ Task 2.

- [ ] Tests định dạng thật JPEG/PNG/WebP/AVIF/PDF, đúng giới hạn, boundary 20/25 MiB; SVG/HTML renamed PNG bị từ chối; 12.001 pixel bị từ chối; path traversal filename không ảnh hưởng key.

Assertion tiêu biểu:

```ts
test('svg_upload_is_rejected', async () => {
  const file = new File(['<svg onload="alert(1)"/>'], 'image.png', { type: 'image/png' });
  await expect(uploadMedia(env, actor, file)).rejects.toMatchObject({ status: 415 });
});
```
- [ ] Tests hai file checksum trùng trả thông báo existing media, không tạo duplicate active object; R2 lỗi không tạo D1 record; D1 lỗi dọn R2 object mới hoặc ghi object tag orphan để Cron tìm được.
- [ ] Chạy media-upload test; phải FAIL.
- [ ] Implement streaming size limit trước khi buffer; MIME bằng magic bytes và image decoder/header parser tin cậy, kiểm tra truncated file; UUID key; SHA-256 thật lưu trong R2 customMetadata lẫn D1.
- [ ] API POST multipart upload, GET cursor pagination/search và reference locations; require actor. Phân trang theo id ổn định, filename escape. R2 bucket không public.
- [ ] Chạy tests, Workers runtime kiểm tra thư viện không cần Node native modules. Commit `feat: upload validated media to R2`.

## Task 9: Cung cấp ảnh, PDF và cleanup an toàn

**Files:** Create `src/server/media/{serve,cleanup}.ts`, `src/pages/media/[id].ts`, `src/worker.ts`, `tests/integration/media-serving.test.ts`, `tests/integration/media-cleanup.test.ts`.

**Interfaces:** `serveMedia(request: Request, env: AppEnv, id: string): Promise<Response>`; `softDeleteMedia(env, actor, id): Promise<void>`; `cleanupMedia(env, now: Date): Promise<{ deleted: number; skipped: number }>`. src/worker.ts delegates fetch to Astro adapter entry and handles scheduled; validate adapter entry path from Task 1.

- [ ] Tests media referenced only in draft: anonymous 404, authenticated permitted user 200 no-store; public media cached một năm; revoked user denied. Query `width` ngoài 480/768/1200/2400 bị từ chối.

Assertion tiêu biểu:

```ts
test('draft_media_is_not_public', async () => {
  const response = await serveMedia(new Request('https://site.test/media/' + draftMediaId), env, draftMediaId);
  expect(response.status).toBe(404);
});
```
- [ ] Tests Images AVIF/WebP theo Accept có cache variant key và Vary; failed transform fallback original; PDF Content-Disposition attachment, nosniff. Không render PDF như HTML.
- [ ] Tests soft delete media đang draft/revision dùng → 409; cleanup age 29 days skip, 30 days delete nếu hash match, mismatch skip/log; references concurrent cleanup không xóa file mới dùng.
- [ ] Chạy test files; phải FAIL.
- [ ] Implement media visibility từ revision references của public content và actor cho media còn riêng tư. Public media đã publish vẫn accessible do immutable revisions; không hứa unpublish/revoke instant cho cached media.
- [ ] Implement Images binding với timeout, variants allowlist; private image variants no-store. Cleanup phân trang giới hạn batch và claim deletion atomically để chặn reference mới; kiểm tra R2 checksum customMetadata, không tải toàn bộ file. Cron daily, failure retry idempotent.
- [ ] Chạy tests và build Worker wrapper; commit `feat: serve media variants and clean unused objects`.

## Task 10: API nội dung và preview

**Files:** Create `src/pages/api/admin/content/index.ts`, `src/pages/api/admin/content/[id]/index.ts`, `src/pages/api/admin/content/[id]/[locale]/{draft,publish,restore,revisions}.ts`, `src/pages/preview/[id]/[locale].astro`, `tests/integration/admin-api.test.ts`.

**Interfaces:** GET/POST content list/create; GET item metadata/locales; PUT draft body `{ expectedVersion, data }`; POST publish `{ expectedVersion, expectedSharedVersion }`; POST restore `{ revisionId, expectedVersion, expectedSharedVersion }`; GET revisions cursor. PUT item `{ expectedSharedVersion, slug, shared }` dùng saveItemMetadata.

- [ ] Tests API 400 schema error fields, 409 conflict, editor publish/restore 403; success publish includes revisionId and cacheStatus; purge failure returns successful publish with pending, không generic 500.

Assertion tiêu biểu:

```ts
test('preview_cannot_be_cached', async () => {
  const response = await SELF.fetch('https://site.test/preview/' + itemId + '/vi', { headers: adminHeaders });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.text()).toContain('noindex');
});
```
- [ ] Tests preview uses draft and same render components; noindex/no-store; no JWT 401; IDOR cross-item revision blocked; public GET không exposes API payload.
- [ ] Chạy admin-api test; phải FAIL.
- [ ] Implement thin handlers dùng service tasks trước, actor từ locals; HTTP body limit 1 MiB (riêng media dùng limits riêng); trusted origin từ config, không từ Host header.
- [ ] Implement Preview layout dùng Snapshot draft và shared current; GET không save/publish. Errors chuẩn từ Task 3.
- [ ] Chạy integration tests; commit `feat: expose draft publish restore and preview API`.

## Task 11: Biểu mẫu admin và lịch sử

**Files:** Create `src/layouts/AdminLayout.astro`, `src/components/admin/{Navigation,LocaleTabs,HomepageForm,InsightForm,SettingsForm,RevisionList}.astro`, `src/client/admin/{editor,api,repeaters}.ts`, `src/styles/admin.css`, `src/pages/admin/index.astro`, `src/pages/admin/content/{index,[id]}.astro`, `tests/e2e/editor.spec.ts`.

**Interfaces:** Uses Task 10 API; client `saveEditorDraft(itemId: string, locale: Locale, version: number, data: LocaleData): Promise<Draft>`. Admin UI buttons dựa role, API vẫn kiểm quyền.

- [ ] E2E fixtures ký Access JWT local, không production bypass. Tests create Insight, switch tabs giữ dirty data, save rồi preview; inline schema errors; unsaved exit dialog; 409 giữ input và cung cấp copy/reload.

Assertion tiêu biểu:

```ts
test('editor_has_no_publish_button', async ({ page }) => {
  await page.goto('/admin/content/' + itemId);
  await expect(page.getByRole('button', { name: 'Xuất bản', exact: true })).toHaveCount(0);
});
```
- [ ] Tests offline/network save failure giữ dữ liệu; double click publish disabled pending; Editor không có publish/restore action; Admin restore thành draft, sau đó publish bằng hành động riêng.
- [ ] Chạy Playwright file, phải FAIL thiếu UI.
- [ ] Implement form có cấu trúc mọi field homepage và repeatable arrays; VI/EN/JA tabs + status/revision/time. Nội dung admin tiếng Việt, timezone hiển thị Asia/Saigon. Không editor JSON thô thay cho form.
- [ ] Dashboard query drafts/missing locale/last publish/audit; settings form không cho đổi trusted site origin. Markdown editor textarea + preview, không WYSIWYG phức tạp.
- [ ] Chạy E2E và axe kiểm keyboard/focus/labels; commit `feat: add structured multilingual content editor`.

## Task 12: Media UI và quản lý users

**Files:** Create `src/pages/admin/{media,users}.astro`, `src/components/admin/MediaPicker.astro`, `src/client/admin/{media,users}.ts`, `src/pages/api/admin/media/[id].ts`, `src/pages/api/admin/users/{index,[id]}.ts`, `tests/e2e/admin-management.spec.ts`, `tests/integration/users.test.ts`.

**Interfaces:** `inviteUser(db, actor, email, role): Promise<string>`; `updateUser(db, actor, userId, role, active): Promise<void>`; arguments typed Role/boolean/Actor; bootstrap uses same email normalization.

- [ ] Tests last active Admin không được demote/disable, kể cả hai request concurrently; duplicate normalized email 409; disabled user denied immediately even existing JWT.

Assertion tiêu biểu:

```ts
test('last_admin_cannot_be_disabled', async () => {
  await expect(updateUser(db, actor, actor.id, 'admin', false)).rejects.toMatchObject({ status: 409 });
});
```
- [ ] E2E upload/search/select image, alt locale riêng, reference locations, duplicate file message; media in-use không delete, soft delete unused có confirmation. Filename malicious không XSS.
- [ ] Chạy integration/E2E files, phải FAIL.
- [ ] Implement Admin-only users endpoints/UI, invite pending subject, audit; atomic guard giữ tối thiểu một Admin. MediaPicker lấy ID, không arbitrary external upload URL.
- [ ] UI giải thích invitation D1 chưa thay Access policy, link dashboard Zero Trust cấu hình riêng; không tự cấp quyền Access qua ứng dụng.
- [ ] Chạy tests; commit `feat: manage CMS users and media library`.

## Task 13: Regression toàn hệ thống và CI

**Files:** Create `tests/e2e/{publishing,seo,accessibility}.spec.ts`, `tests/integration/security.test.ts`, `.github/workflows/astro-checks.yaml`. Modify `playwright.config.ts`, `README.md`.

**Interfaces:** `npm run verify` runs type check + unit + integration + E2E + production build; `npm run worker:dev` chạy built Worker có D1/R2 test data isolated.

- [ ] Tests đi hết VI draft → preview → publish → edit → restore, EN/JA độc lập, redirect và shared images không thay published trước publish.

Assertion tiêu biểu:

```ts
test('unpublished_insight_is_missing', async ({ request }) => {
  const response = await request.get('/en/insights/draft-only/');
  expect(response.status()).toBe(404);
});
```
- [ ] Tests logout/expiry/disabled user, spoofed Access headers, malicious Markdown và HTML JSON-LD, credentials trong URL/query không vào logs; private response cache leakage across actors.
- [ ] Tests homepage/menu/mobile, Insight empty/error pages, canonical/hreflang/sitemap published-only và axe critical/serious zero. Capture results có số test, skipped phải báo riêng.
- [ ] Chạy suites, xác định FAIL coverage mới trước khi bổ sung regression fixes.
- [ ] CI frozen `npm ci`, migrations local, Playwright dependencies; không Cloudflare deploy hoặc credentials thật. README local startup và manual content entry, không dùng Hugo cho dev mới.
- [ ] Chạy verify sạch và Wrangler dry-run; test entry có Cron. Commit `test: verify CMS security publishing and SEO`.

## Task 14: Backup, bootstrap và runbook vận hành

**Files:** Create `scripts/{bootstrap-admin,backup,restore-rehearsal}.ts`, `docs/operations/{cloudflare,backup}.md`, `tests/integration/operations.test.ts`.

**Interfaces:** npm scripts `admin:bootstrap`, `backup`, `restore:rehearsal`; `bootstrapAdmin(db: D1Database, email: string): Promise<string>`; `createBackup(config: BackupConfig): Promise<BackupManifest>`; `restoreRehearsal(config: RestoreConfig): Promise<{ dbVerified: boolean; inventoryVerified: boolean }>`. Export config types từ script tương ứng, fields chỉ explicit target, DB ID/name, MEDIA/backup bucket và runtime credential provider. Bootstrap nhận email từ prompt/runtime config, explicit target local/production. BackupManifest có `createdAt: string`, `schemaVersion: string`, `dbExportKey: string`, `r2InventoryKey: string`, `checksums: Record<string, string>`.

- [ ] Tests bootstrap chỉ khi chưa có Admin, repeated same email idempotent, different email refused; không log/commit email; no implicit remote operation.

Assertion tiêu biểu:

```ts
test('failed_backup_keeps_completed_sets', async () => {
  await expect(createBackup(failingBackupConfig)).rejects.toThrow();
  expect(await backupBucket.head(previousManifestKey)).not.toBeNull();
});
```
- [ ] Tests backup xuất D1 và R2 paginated inventory >1000 objects, kiểm checksum và giữ bốn completed weekly sets; failed set không xóa previous. Restore vào resource local mới có published snapshot và media inventory counts khớp.
- [ ] Chạy operations tests, phải FAIL.
- [ ] Implement scripts sử dụng official Wrangler/Cloudflare API, không in token. Backup bucket tách MEDIA, manifest đánh dấu complete cuối; không coi inventory là backup bytes của R2. Media gốc chưa purge được giữ; runbook chỉ rõ cách khôi phục file soft-deleted trước 30 ngày.
- [ ] Runbook: Time Travel retention theo gói thật, weekly backup operator schedule, restore rehearsal, D1 expand/migrate/contract, incident request ID, purge pending và Worker rollback.
- [ ] Chạy local rehearsal + operations tests; commit `chore: add CMS backup and recovery operations`.

## Task 15: Cấu hình production và kiểm chứng Cloudflare

**Files:** Modify `wrangler.jsonc`, `package.json`; Create `scripts/smoke-production.ts`, `docs/operations/deployment-evidence.md`; Modify `docs/operations/cloudflare.md`.

**Interfaces:** command `npm run smoke:production -- --origin <worker-test-host>`; authenticated browser tests thực hiện bằng Access login, không bypass.

- [ ] Kiểm tên/presence bindings đã có, read-only account/zone access; yêu cầu riêng những cấu hình thiếu qua settings an toàn. Cần account/zone, D1/R2/Images resources, Access team/audience và Admin identity, purge token, Workers Builds connection. Không yêu cầu secret trong chat.
- [ ] Chốt versions và khả năng Images/cache trên gói tài khoản thật; rate/cost limits runbook. Tạo tài nguyên đúng tên, Access policies exact admin/api/preview và mọi route alias; Workers dev hostname cũng phải protected hoặc disabled ngoài hostname thử nghiệm đã bảo vệ.
- [ ] Dùng deploy credentials được cấp; apply migrations trước app tương thích, bootstrap Admin và deploy Worker test host. Đăng ký resources IDs trong config runtime/local ignored override; config committed chỉ template và binding names.
- [ ] Chạy smoke public+Access+Admin+Editor, draft isolation, image variants/fallback, purge: warm content, publish, verify nội dung mới từ ít nhất hai edge location. Cache API purge không đúng → sửa implementation/config và chạy lại, không tuyên bố global purge từ một local cache.delete.
- [ ] Chạy backup/restore rehearsal production vào tài nguyên tạm riêng, kiểm count/checksum; xác minh rollback deployment tương thích schema. Ghi deployment ID, test counts, timestamps và limitations, không token/identity private.
- [ ] Commit config/runbook/evidence sanitized `chore: verify Cloudflare production deployment`. Nếu chưa có account/credential, hoàn thành code và local tests, báo Task 15 bị chặn; không tự đánh dấu production passing.

## Task 16: Chuyển tên miền và nghỉ hưu Hugo/Decap

**Files:** Create `docs/operations/cutover.md`; Modify `README.md`; remove legacy `hugo.yaml`, `layouts/**`, `content/**`, `data/settings.yaml`, `i18n/**`, `static/**`, `oauth-proxy/**`, `scripts/optimize_uploads.py`, `.github/workflows/{hugo,optimize-media}.yaml`, generated root HTML/CNAME/CSS/JS, `vi/**`, `en/**`, `ja/**`, `admin/**`, `images/og-default.svg` only after validated cutover.

**Interfaces:** Production `https://tnchandicraft.com`; no Hugo/Decap runtime dependency. Root target `/vi/`; www canonical redirect only if hostname ownership confirmed.

- [ ] Viết cutover checklist + rollback: record hiện trạng DNS/Pages, target Worker version, Access policy custom domain, backup manifests. Người dùng đã chọn chuyển sớm; không chờ nhập đủ content.
- [ ] Kiểm production test host Task 15 passing và có cấu hình tối thiểu không bịa liên hệ; tạo custom domain, TLS, Access trước public handoff. Route private trên custom domain phải fail closed ngay từ request đầu.
- [ ] Chuyển domain, smoke 3 homepage, Admin/Editor/preview, drafts hidden, media, SEO, publish và purge; theo dõi 404. Nếu security fail, rollback routing ngay; không disable Pages trước khi Worker domain kiểm chứng.
- [ ] Disable Pages deploy và Pages serving; gỡ OAuth route cũ sau khi kiểm không còn consumer; không gỡ toàn zone/domain/service không liên quan.
- [ ] Trước xóa legacy, ghi commit recovery ref và soát user changes. Loại khỏi runtime, xóa bằng patch chỉ những legacy paths đã kiểm; nội dung cũ vẫn truy hồi từ Git, không import vào D1.
- [ ] Run `npm run verify` sau cleanup, smoke production lần cuối, log cutover/rollback evidence và weekly backup schedule. Commit `chore: retire Hugo and GitHub Pages after cutover`.

## Ma trận độ bao phủ đặc tả

| Spec | Task |
| --- | --- |
| Mục tiêu/phạm vi/kiến trúc | 1, 7, 13, 15–16 |
| Access/Admin/Editor/bootstrap | 3, 12, 14–15 |
| D1/schema/draft_version | 2, 4–5 |
| Locale/preview/publish/restore/revision | 4–5, 10–11, 13 |
| Structured admin/dashboard | 10–12 |
| R2/limits/Images/references/Cron | 8–9, 12, 15 |
| Public queries/cache/purge failures | 6–7, 13, 15 |
| SEO/redirect/sitemap | 5, 7, 13 |
| Errors/backup/migrations/rollback | 3–6, 8–9, 14–16 |
| Tests/cutover/acceptance | 13–16 |

## Tự rà soát và bàn giao

- Kế hoạch quyết định file, interface và tests; không chứa triển khai sản phẩm hoặc secret.
- Types Snapshot/Draft/Published và revision paths dùng xuyên task, không render shared draft trong public.
- Phần thực thi Cloudflare cần kiểm chứng thật; kế hoạch không xem một local build là bằng chứng deploy/cutover.
- Tại thời điểm lập kế hoạch chưa chạy bộ test Astro vì ứng dụng chưa được tạo.
- Sau khi người dùng xem kế hoạch, chọn Native (thực hiện trực tiếp với executing-plans) hoặc Subagent-driven (mỗi task có agent triển khai/review với subagent-driven-development). Chưa bắt đầu implementation trước lựa chọn này.
