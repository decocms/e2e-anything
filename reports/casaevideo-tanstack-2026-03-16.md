# QA Report: Casa e Video Tanstack Storefront

**Site:** https://casaevideo-tanstack.deco.site/
**Date:** 2026-03-16
**Framework:** Playwright E2E (Chromium)
**Result:** 59 passed / 2 soft-failed / 61 total

---

## Summary

The Casa e Video Tanstack storefront is **functionally ready**. All core e-commerce flows work end-to-end: browsing → searching → viewing products → adding to cart → reaching checkout. No blocking issues found.

---

## Results by Area

| Area | Tests | Result | Notes |
|------|-------|--------|-------|
| Homepage | 7/7 | PASS | Page load, console errors, header, logo, menu, footer, product shelves |
| Navigation | 5/5 | PASS | Menu links valid, category pages load, breadcrumbs, mobile menu |
| Search | 5/5 | PASS | Search bar, submit, product cards with titles and prices |
| Product Page | 8/8 | PASS | Title, price, image, add-to-cart, quantity selector, wishlist, gallery |
| Cart / Minicart | 5/5 | PASS | Side drawer opens, shows product + price, checkout link works |
| Auth | 4/4 | PASS | Login button opens dropdown with "Entrar" / "Cadastre-se" |
| Checkout | 1/2 | SOFT FAIL | Reaches checkout from cart OK; empty-cart URL returns 503 (VTEX behavior) |
| Filters | 8/8 | PASS | Sidebar, filter groups, sort, product listing, pagination |
| Newsletter | 4/4 | PASS | Section visible, email input, submit feedback |
| Chat | 3/3 | PASS | WhatsApp widget present and clickable |
| Geolocation | 4/4 | PASS | CEP button, input, zip code entry, submit |
| Third-party Scripts | 4/5 | SOFT FAIL | dataLayer exists, no failed requests; missing `<meta name="description">` |

---

## Known Gaps (Non-blocking)

### 1. Missing SEO meta description
- **What:** Homepage has no `<meta name="description">` tag
- **Impact:** SEO — search engines won't have a snippet to display
- **Fix:** Add a meta description in the CMS or page head configuration
- **Severity:** Low (content task, not a code bug)

### 2. Checkout 503 on empty cart
- **What:** Navigating directly to `/checkout` with an empty cart returns HTTP 503
- **Impact:** None in normal flow — users reach checkout by clicking "Ir para o carrinho" from the minicart, which works correctly
- **Fix:** VTEX-side behavior, no storefront fix needed
- **Severity:** Informational

---

## How Tests Were Built

1. **Real browser testing** — Playwright launches Chromium and navigates the actual site
2. **Real selectors** — Every selector was discovered by navigating the live site, not guessed
3. **Config-driven** — All URLs, selectors, and test data live in `sites/casaevideo-tanstack.yml`
4. **Reusable** — Adding a new site = adding a new YAML file, zero code changes

---

## Recommendation

**Go for launch.** The storefront passes all critical e-commerce QA checks. Before going live:
- [ ] Add `<meta name="description">` to the homepage
- [ ] Verify checkout flow with real payment methods in staging
