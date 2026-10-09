import { expect, test } from "@playwright/test";

test("homepage có canonical, robots và x-default an toàn", async ({ page }) => {
  await page.goto("/vi/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://site.test/vi/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index,follow");
  await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute("href", "https://site.test/");
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.length).toBeGreaterThan(0);
  expect(jsonLd.join("")).not.toContain("<script");
});

test("sitemap không chứa route admin, preview hoặc draft", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.ok()).toBeTruthy();
  const xml = await response.text();
  expect(xml).not.toContain("/admin");
  expect(xml).not.toContain("/preview");
  expect(xml).not.toContain("draft-only");
});

test("route insight chưa publish trả 404", async ({ request }) => {
  expect((await request.get("/en/insights/draft-only/")).status()).toBe(404);
});
