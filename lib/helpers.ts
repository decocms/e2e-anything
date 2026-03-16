import { type Page, type Locator, expect } from "@playwright/test";
import { type SiteConfig } from "./config";

/**
 * Navigate to a page defined in the site config and wait for it to load.
 */
export async function goTo(page: Page, config: SiteConfig, pagePath: string) {
  const url = pagePath.startsWith("http")
    ? pagePath
    : `${config.baseUrl}${pagePath}`;
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  return response;
}

/**
 * Find the first matching locator from a comma-separated selector string.
 * Tries each selector and returns the first one that has visible elements.
 */
export async function findFirst(
  page: Page,
  selectorString: string
): Promise<Locator> {
  const selectors = selectorString.split(",").map((s) => s.trim());
  for (const selector of selectors) {
    const loc = page.locator(selector);
    if ((await loc.count()) > 0) {
      return loc;
    }
  }
  return page.locator(selectors[0]);
}

/**
 * Collect all href attributes from links matching a selector.
 */
export async function collectLinks(
  page: Page,
  selector: string
): Promise<string[]> {
  const links = await page.locator(selector).all();
  const hrefs: string[] = [];
  for (const link of links) {
    const href = await link.getAttribute("href");
    if (href) {
      hrefs.push(href);
    }
  }
  return hrefs;
}

/**
 * Check that a URL returns a non-error HTTP status (not 4xx/5xx).
 */
export async function checkUrlStatus(
  page: Page,
  url: string,
  baseUrl: string
): Promise<{ url: string; status: number; ok: boolean }> {
  const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url}`;
  try {
    const response = await page.request.get(fullUrl);
    return {
      url: fullUrl,
      status: response.status(),
      ok: response.status() < 400,
    };
  } catch {
    return { url: fullUrl, status: 0, ok: false };
  }
}

/**
 * Discover a product URL from a category/search page.
 */
export async function discoverProductUrl(
  page: Page,
  config: SiteConfig
): Promise<string | null> {
  const links = await page.locator("a[href*='/p']").all();
  for (const link of links) {
    const href = await link.getAttribute("href");
    if (href && href.includes("/p")) {
      return href.startsWith("http") ? href : `${config.baseUrl}${href}`;
    }
  }
  return null;
}

/**
 * Discover a category URL from the menu navigation.
 */
export async function discoverCategoryUrl(
  page: Page,
  config: SiteConfig
): Promise<string | null> {
  if (config.pages.category) {
    return config.pages.category;
  }
  const menuLinks = await page.locator(config.selectors.menuLinks).all();
  for (const link of menuLinks) {
    const href = await link.getAttribute("href");
    if (href && href.startsWith("/") && !href.includes("?map=")) {
      return href;
    }
  }
  return null;
}

/**
 * Wait for network to be mostly idle (no pending requests for 500ms).
 */
export async function waitForStable(page: Page, timeout = 5000) {
  try {
    await page.waitForLoadState("networkidle", { timeout });
  } catch {
    // networkidle can be flaky, just continue
  }
}

/**
 * Check if a test should be skipped based on config.
 */
export function shouldSkip(config: SiteConfig, testName: string): boolean {
  return config.skip.includes(testName);
}

/**
 * Dismiss cookie consent banner if present.
 */
export async function dismissCookieConsent(page: Page) {
  try {
    const consentBtn = page.locator(
      "button:has-text('Aceitar e continuar'), button:has-text('Aceitar'), button:has-text('Concordo'), button:has-text('Accept'), button:has-text('Aceito')"
    ).first();
    if (await consentBtn.isVisible({ timeout: 2000 })) {
      await consentBtn.click();
      await page.waitForTimeout(500);
    }
  } catch {
    // No consent banner
  }
}

/**
 * Collect console errors during a page action.
 */
export async function collectConsoleErrors(
  page: Page,
  action: () => Promise<void>
): Promise<string[]> {
  const errors: string[] = [];
  const handler = (msg: any) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  };
  page.on("console", handler);
  await action();
  page.off("console", handler);
  return errors;
}
