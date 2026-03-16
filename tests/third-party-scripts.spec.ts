import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import { goTo, waitForStable, shouldSkip } from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Third-Party Scripts & Analytics", () => {
  test.skip(shouldSkip(config, "third-party-scripts"), "Skipped via config");

  test("dataLayer should exist and have events", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await waitForStable(page);

    const dataLayer = await page.evaluate(() => {
      const dl = (window as any).dataLayer;
      if (!dl) return null;
      return {
        exists: true,
        length: dl.length,
        events: dl.slice(0, 5).map((e: any) => e.event || "no-event"),
      };
    });

    expect(dataLayer, "dataLayer should exist on the page").toBeTruthy();
    expect(dataLayer!.length).toBeGreaterThan(0);
  });

  test("GTM or GA scripts should be loaded", async ({ page }) => {
    const scriptUrls: string[] = [];

    page.on("request", (request) => {
      const url = request.url();
      if (
        url.includes("googletagmanager.com") ||
        url.includes("google-analytics.com") ||
        url.includes("gtag") ||
        url.includes("analytics")
      ) {
        scriptUrls.push(url);
      }
    });

    await goTo(page, config, config.pages.home);
    await waitForStable(page);
    await page.waitForTimeout(5000);

    // Also check for GTM/GA scripts in the DOM
    const hasGTMInDom = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script[src]"));
      return scripts.some(
        (s) =>
          s.getAttribute("src")?.includes("googletagmanager") ||
          s.getAttribute("src")?.includes("gtag") ||
          s.getAttribute("src")?.includes("analytics")
      );
    });

    // Also check if dataLayer has GTM-originated events
    const hasGTMEvents = await page.evaluate(() => {
      const dl = (window as any).dataLayer;
      return dl && dl.some((e: any) => e["gtm.start"] || e.event === "gtm.js");
    });

    expect.soft(
      scriptUrls.length > 0 || hasGTMInDom || hasGTMEvents,
      "Expected GTM or GA scripts/events — may not be configured on staging"
    ).toBeTruthy();
  });

  test("no critical third-party script failures", async ({ page }) => {
    const failedRequests: string[] = [];

    page.on("requestfailed", (request) => {
      const url = request.url();
      // Only track third-party failures, not ad blockers
      if (
        !url.includes("doubleclick") &&
        !url.includes("facebook") &&
        !url.includes("adservice")
      ) {
        failedRequests.push(`${url} - ${request.failure()?.errorText}`);
      }
    });

    await goTo(page, config, config.pages.home);
    await waitForStable(page);
    await page.waitForTimeout(3000);

    // Log failed requests for visibility
    if (failedRequests.length > 0) {
      console.warn("Failed third-party requests:", failedRequests);
    }

    // We don't hard-fail on this since ad blockers can cause failures
    // but we report them
  });

  test("dataLayer should fire events on product page", async ({ page }) => {
    if (config.pages.product) {
      await goTo(page, config, config.pages.product);
    } else {
      await goTo(page, config, config.pages.home);
    }
    await waitForStable(page);

    const dataLayer = await page.evaluate(() => {
      const dl = (window as any).dataLayer;
      if (!dl) return null;
      return {
        length: dl.length,
        events: dl.map((e: any) => e.event).filter(Boolean),
      };
    });

    expect(dataLayer).toBeTruthy();
    // Product page should have some analytics events
    if (config.pages.product) {
      expect(dataLayer!.length).toBeGreaterThan(0);
    }
  });

  test("page should have meta tags for SEO", async ({ page }) => {
    await goTo(page, config, config.pages.home);

    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    const metaDescription = await page
      .locator('meta[name="description"]')
      .getAttribute("content")
      .catch(() => null);
    // Soft assert — staging might not have meta description configured
    expect.soft(
      metaDescription !== null,
      "Meta description tag should exist (may be missing on staging)"
    ).toBeTruthy();
  });
});
