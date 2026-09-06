import { expect, test } from "@playwright/test";
import { login, logout, register, registerViaApi } from "./helpers";

test("registers, logs out, and logs back in", async ({ page }, info) => {
  const user = await register(page, "auth");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: user.email, exact: true })).toBeVisible();
  await logout(page);
  await expect(page.getByLabel("Email")).toBeEnabled();
  await expect(page.getByLabel("Password")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("auth-ready.png"), fullPage: true, animations: "disabled" });

  await login(page, user.email, user.password);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: user.email, exact: true })).toBeVisible();
});

test("redirects protected routes to login", async ({ page }) => {
  await page.goto("/today");

  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("authenticated root route redirects to Today", async ({ page }) => {
  await registerViaApi(page, "root-redirect");

  await Promise.all([
    page.waitForURL(/\/today$/),
    page.goto("/").catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes("interrupted by another navigation")) {
        throw error;
      }
    }),
  ]);

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});
