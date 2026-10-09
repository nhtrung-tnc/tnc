import { expect, test, type APIRequestContext } from "@playwright/test";

const jwt = process.env.E2E_ADMIN_ACCESS_JWT;
test.skip(!jwt, "Cần JWT Cloudflare Access của Admin để chạy E2E publish");
test.use({ extraHTTPHeaders: { "Cf-Access-Jwt-Assertion":jwt ?? "" } });

const data = (title:string) => ({
  title,
  description:"Mô tả regression publish",
  bodyMarkdown:"## Nội dung an toàn\n\n<script>alert(1)</script>\n\nNội dung hiển thị.",
  author:"TNC Handicraft",
  displayDate:"2026-10-09",
  seo:{ title, description:"Mô tả SEO", image:null },
  primaryMediaAlt:"",
});

async function admin(request: APIRequestContext, url:string, method:"post" | "put", body:unknown) {
  return request[method](url, { data:body, headers:{ Origin:"https://site.test" } });
}

test("VI draft → preview → publish → edit → restore; EN/JA độc lập", async ({ page, request }) => {
  const slug = `publishing-${Date.now()}`;
  const created = await admin(request, "/api/admin/content", "post", { type:"insight", slug });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id:string };

  const saved = await admin(request, `/api/admin/content/${id}/vi/draft`, "put", {
    expectedVersion:1,
    data:data("Phiên bản đầu"),
  });
  expect(saved.ok()).toBeTruthy();
  expect((await request.get(`/vi/insights/${slug}/`)).status()).toBe(404);
  await page.goto(`/preview/${id}/vi`);
  await expect(page.getByRole("heading", { name:"Phiên bản đầu" })).toBeVisible();

  const published = await admin(request, `/api/admin/content/${id}/vi/publish`, "post", {
    expectedVersion:2,
    expectedSharedVersion:1,
  });
  expect(published.ok()).toBeTruthy();
  await page.goto(`/vi/insights/${slug}/`);
  await expect(page.getByRole("heading", { name:"Phiên bản đầu" })).toBeVisible();
  await expect(page.locator("script", { hasText:"alert(1)" })).toHaveCount(0);
  expect((await request.get(`/en/insights/${slug}/`)).status()).toBe(404);
  expect((await request.get(`/ja/insights/${slug}/`)).status()).toBe(404);

  expect((await admin(request, `/api/admin/content/${id}/vi/draft`, "put", {
    expectedVersion:3,
    data:data("Bản chỉnh sửa chưa publish"),
  })).ok()).toBeTruthy();
  await page.goto(`/vi/insights/${slug}/`);
  await expect(page.getByRole("heading", { name:"Phiên bản đầu" })).toBeVisible();

  const history = await request.get(`/api/admin/content/${id}/vi/revisions`);
  const revisions = await history.json() as { items:Array<{ id:string }> };
  const restored = await admin(request, `/api/admin/content/${id}/vi/restore`, "post", {
    revisionId:revisions.items[0].id,
    expectedVersion:4,
    expectedSharedVersion:1,
  });
  expect(restored.ok()).toBeTruthy();
  await page.goto(`/preview/${id}/vi`);
  await expect(page.getByRole("heading", { name:"Phiên bản đầu" })).toBeVisible();
  expect((await admin(request, `/api/admin/content/${id}/vi/publish`, "post", {
    expectedVersion:5,
    expectedSharedVersion:1,
  })).ok()).toBeTruthy();
});
