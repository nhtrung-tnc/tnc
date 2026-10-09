import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const viewport of [
  { name:"desktop", width:1280, height:900 },
  { name:"mobile", width:390, height:844 },
]) {
  test(`homepage ${viewport.name} không có lỗi axe critical/serious`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/vi/");
    await expect(page.getByRole("navigation")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  });
}

test("trang danh sách Insight rỗng vẫn có landmark và heading", async ({ page }) => {
  await page.goto("/vi/insights/");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level:1 })).toBeVisible();
});
