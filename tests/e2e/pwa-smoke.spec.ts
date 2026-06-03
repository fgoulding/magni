import { expect, test } from "@playwright/test";

test("serves installable PWA metadata and iOS icons", async ({ page, request }) => {
  await page.goto("/login");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.json");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);

  const manifest = await request.get("/manifest.json");
  expect(manifest.ok()).toBe(true);
  const manifestBody = await manifest.json();
  expect(manifestBody.display).toBe("standalone");

  const appleIcon = await request.get("/apple-touch-icon.png");
  expect(appleIcon.ok()).toBe(true);
});
