# e2e-anything

Reusable E2E QA test suite for e-commerce sites. Add a YAML config file per site and run 61 Playwright tests covering 12 areas.

## Quick Start

```bash
npm install
npx playwright install chromium

# Run all tests for a site
SITE=casaevideo-tanstack npx playwright test

# Run a specific test file
SITE=casaevideo-tanstack npx playwright test tests/cart.spec.ts

# Run with headed browser
SITE=casaevideo-tanstack npx playwright test --headed

# Run with UI mode
SITE=casaevideo-tanstack npx playwright test --ui

# Generate HTML report
SITE=casaevideo-tanstack npx playwright test --reporter=html
npx playwright show-report
```

## Test Areas (12 files, 61 tests)

| File | Tests | What it checks |
|------|-------|----------------|
| `homepage.spec.ts` | 7 | Page load, console errors, header, menu, search bar, footer, product shelves |
| `navigation.spec.ts` | 5 | Menu links, category navigation, breadcrumb, mobile menu |
| `search.spec.ts` | 5 | Search input, submit, product cards, titles/prices |
| `product.spec.ts` | 8 | PDP: title, price, image, add-to-cart, quantity, wishlist, gallery |
| `cart.spec.ts` | 5 | Add to cart, minicart, quantity controls, checkout link, coupon |
| `auth.spec.ts` | 4 | Login button, dropdown/modal, login form, my-account |
| `checkout.spec.ts` | 2 | Reach checkout from cart, checkout page status |
| `filters.spec.ts` | 8 | Sidebar, filter groups, price filter, sort, products, pagination |
| `newsletter.spec.ts` | 4 | Newsletter section, input/button, email typing, submit |
| `chat.spec.ts` | 3 | Chat widget, WhatsApp link, clickable |
| `geolocation.spec.ts` | 4 | CEP button, input, typing, submit |
| `third-party-scripts.spec.ts` | 5 | dataLayer, GTM/GA, failed requests, product events, SEO meta |

## Adding a New Site

Create a YAML file in `sites/`:

```yaml
# sites/my-store.yml
name: "My Store"
baseUrl: "https://my-store.example.com"

pages:
  home: "/"
  category: "/shoes"
  product: "/nike-air-max/p"
  cart: "/checkout"
  login: "/login"
  myAccount: "/my-account"
  search: "/search"

testData:
  searchTerm: "sneakers"
  cep: "01001-000"
  newsletterEmail: "test@example.com"

selectors:
  searchInput: "input[type='search']"
  searchButton: "button[type='submit']"
  addToCartButton: "button:has-text('Add to Cart')"
  checkoutButton: "a:has-text('Checkout')"
  # ... override any selector from lib/config.ts defaults

skip: []  # or ["chat", "newsletter"] to skip test groups
```

Then run:

```bash
SITE=my-store npx playwright test
```

## How It Works

1. **Config loader** (`lib/config.ts`) reads the YAML file and merges with default selectors
2. **Helpers** (`lib/helpers.ts`) provide shared utilities: navigation, cookie dismissal, link collection, stability waits
3. **Tests** read the config to know URLs, selectors, and test data — no hardcoded values
4. **Skip** any test group by adding its name to the `skip` array in the YAML config

## Project Structure

```
e2e-anything/
  sites/                        # One YAML config per site
    casaevideo-tanstack.yml
  tests/                        # 12 test files
    homepage.spec.ts
    navigation.spec.ts
    search.spec.ts
    product.spec.ts
    cart.spec.ts
    auth.spec.ts
    checkout.spec.ts
    filters.spec.ts
    newsletter.spec.ts
    chat.spec.ts
    geolocation.spec.ts
    third-party-scripts.spec.ts
  lib/
    config.ts                   # YAML config loader + defaults
    helpers.ts                  # Shared test utilities
  playwright.config.ts          # Playwright configuration
```
