import { expect, test } from "@playwright/test";

const jwt = process.env.E2E_ACCESS_JWT;
const itemId = process.env.E2E_EDITOR_ITEM_ID;
test.skip(!jwt || !itemId, "Cần JWT Access ký local và item fixture để chạy E2E editor");
test.use({ extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": jwt ?? "" } });

test("editor giữ dữ liệu khi đổi locale và không thấy nút xuất bản", async ({ page }) => {
  await page.goto(`/admin/content/${itemId}/`);
  const title = page.locator('[data-locale-panel="vi"] [data-path="title"]');
  await title.fill("Bản nháp chưa lưu");
  await page.getByRole("tab", { name: "English" }).click();
  await page.getByRole("tab", { name: "Tiếng Việt" }).click();
  await expect(title).toHaveValue("Bản nháp chưa lưu");
  await expect(page.getByRole("button", { name: "Xuất bản", exact: true })).toHaveCount(0);
});

test("tạo Insight, lưu nháp rồi xem trước", async ({ page }) => {
  const slug = `e2e-${Date.now()}`;
  await page.goto("/admin/content/");
  await page.getByLabel("Đường dẫn (slug)").fill(slug);
  await page.getByRole("button", { name: "Tạo và chỉnh sửa" }).click();
  await expect(page).toHaveURL(/\/admin\/content\/[0-9a-f-]+\/$/);
  await page.locator('[data-locale-panel="vi"] [data-path="title"]').fill("Bài kiểm thử trình biên tập");
  await page.locator('[data-locale-panel="vi"] [data-path="bodyMarkdown"]').fill("# Nội dung xem trước");
  await page.getByRole("button", { name: "Lưu nháp" }).first().click();
  await expect(page.locator('[data-locale-panel="vi"] [data-editor-status]')).toHaveText("Đã lưu nháp");
  const popupPromise = page.waitForEvent("popup");
  await page.locator('[data-locale-panel="vi"]').getByRole("link", { name: "Xem trước" }).click();
  const preview = await popupPromise;
  await expect(preview.getByRole("heading", { name: "Bài kiểm thử trình biên tập" })).toBeVisible();
});

test("xung đột và lỗi mạng không làm mất dữ liệu đang nhập", async ({ page }) => {
  await page.goto(`/admin/content/${itemId}/`);
  const form = page.locator('[data-locale-panel="vi"] .editor-form');
  const title = form.locator('[data-path="title"]');
  await title.fill("Nội dung phải được giữ lại");
  await page.route(/\/api\/admin\/content\/.*\/vi\/draft$/, (route) => route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "VERSION_CONFLICT", message: "Conflict" } }),
  }));
  await form.getByRole("button", { name: "Lưu nháp" }).click();
  await expect(title).toHaveValue("Nội dung phải được giữ lại");
  await expect(form.getByRole("button", { name: "Sao chép dữ liệu" })).toBeVisible();
  await page.unroute(/\/api\/admin\/content\/.*\/vi\/draft$/);
  await page.route(/\/api\/admin\/content\/.*\/vi\/draft$/, (route) => route.abort("internetdisconnected"));
  await form.getByRole("button", { name: "Lưu nháp" }).click();
  await expect(title).toHaveValue("Nội dung phải được giữ lại");
  await expect(form.locator("[data-editor-status]")).toContainText("dữ liệu vẫn còn");
});
