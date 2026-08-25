import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

async function openReady(page) {
  await page.goto("/");
  await expect(page.locator("#runtime-status")).toHaveText("WASM engine ready");
  await expect(page.locator("#search-button")).toBeEnabled();
  await expect(page.locator("#result-count")).toHaveText("3 matches");
}

test("loads with a completed sample search and highlighted matches", async ({ page }) => {
  await openReady(page);
  await expect(page.locator("#output mark")).toHaveCount(3);
  await expect(page.locator("#output mark").first()).toHaveText("ripgrep");
  await page.locator("#pattern").fill("Rust");
  await page.locator("#haystack").fill("Rust is fast.\nWebAssembly runs locally.");
  await page.locator("#search-button").click();
  await expect(page.locator("#output")).toContainText("Rust is fast.");
  await expect(page.locator("#result-count")).toHaveText("1 match");
});

test("surfaces malformed patterns from WASM", async ({ page }) => {
  await openReady(page);
  await page.locator("#pattern").fill("[");
  await page.locator("#search-button").click();
  await expect(page.locator("#result-count")).toHaveText("Error");
  await expect(page.locator("#error")).toBeVisible();
  await expect(page.locator("#error")).toContainText(/regex|error|unclosed|opening/i);
});

test("filters ignored virtual files before searching", async ({ page }) => {
  await openReady(page);
  await page.locator('[data-mode="walk"]').click();
  await expect(page.locator("#result-count")).toHaveText("2 matches");
  await expect(page.locator("#output")).toContainText("README.md:2: A needle appears");
  await expect(page.locator("#output")).not.toContainText("ignored build output");
  await expect(page.locator("#output mark")).toHaveCount(2);
  await page.locator("#pattern").fill("needle");
  await page.locator("#ignore-patterns").fill("*.log");
  await page.locator("#files").setInputFiles(resolve("e2e/fixtures"));
  await page.locator("#search-button").click();
  await expect(page.locator("#output")).toContainText("keep.txt:1: needle in kept file");
  await expect(page.locator("#output")).not.toContainText("ignored.log");
});

test("searches multiline stdin input", async ({ page }) => {
  await openReady(page);
  await page.locator('[data-mode="stdin"]').click();
  await expect(page.locator("#result-count")).toHaveText("2 matches");
  await expect(page.locator("#output mark")).toHaveCount(2);
  await page.locator("#pattern").fill("^needle$");
  await page.locator("#haystack").fill("first line\nneedle\nlast line");
  await page.locator("#multi-line").check();
  await page.locator("#search-button").click();
  await expect(page.locator("#output")).toContainText("2: needle");
  await expect(page.locator("#result-count")).toHaveText("1 match");
});
