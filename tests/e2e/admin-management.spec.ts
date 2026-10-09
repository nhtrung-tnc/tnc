import { expect, test } from "@playwright/test";

const jwt = process.env.E2E_ADMIN_ACCESS_JWT;
const itemId = process.env.E2E_EDITOR_ITEM_ID;
test.skip(!jwt, "Cần JWT Cloudflare Access của Admin để chạy E2E quản trị");
test.use({ extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": jwt ?? "" } });

function png() {
  const bytes = Buffer.alloc(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  bytes.writeUInt32BE(100, 16);
  bytes.writeUInt32BE(80, 20);
  bytes.set([73, 69, 78, 68], 37);
  return bytes;
}

test("upload an toàn, tìm kiếm và nhận biết tệp trùng", async ({ page }) => {
  const filename = `<img src=x onerror=alert(1)>-${Date.now()}.png`;
  await page.goto("/admin/media/");
  await page.getByLabel("Tệp ảnh hoặc PDF").setInputFiles({ name:filename, mimeType:"image/png", buffer:png() });
  await page.getByRole("button", { name:"Tải lên" }).click();
  await expect(page.locator("[data-upload-status]")).toHaveText("Đã tải lên.");
  await page.locator("[data-media-search]").fill(filename);
  await expect(page.locator("[data-media-results] article")).toContainText(filename);
  await expect(page.locator("[data-media-results] script")).toHaveCount(0);

  await page.getByLabel("Tệp ảnh hoặc PDF").setInputFiles({ name:"duplicate.png", mimeType:"image/png", buffer:png() });
  await page.getByRole("button", { name:"Tải lên" }).click();
  await expect(page.locator("[data-upload-status]")).toContainText("đã tồn tại");
});

test("mời người dùng và hiển thị trạng thái chờ Access", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/admin/users/");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name:"Tạo lời mời" }).click();
  await page.waitForLoadState("networkidle");
  const row = page.locator("[data-user-row]", { hasText:email });
  await expect(row).toContainText("Đang chờ đăng nhập lần đầu");
  await expect(page.getByText("không", { exact:false })).toBeVisible();
});

test("chọn ảnh bằng MediaPicker và giữ alt riêng theo locale", async ({ page }) => {
  test.skip(!itemId, "Cần item fixture để kiểm tra MediaPicker trong editor");
  await page.goto(`/admin/content/${itemId}/`);
  const vi = page.locator('[data-locale-panel="vi"]');
  await vi.getByRole("button", { name:"Chọn từ thư viện" }).first().click();
  await vi.locator("dialog").first().getByRole("button", { name:"Chọn" }).first().click();
  await vi.locator('[data-path="seo.image.alt"]').fill("Ảnh tiếng Việt");
  await page.getByRole("tab", { name:"English" }).click();
  await expect(page.locator('[data-locale-panel="en"] [data-path="seo.image.alt"]')).not.toHaveValue("Ảnh tiếng Việt");
});
