import { parse } from "yaml";
import * as fs from "fs";
import * as path from "path";

export interface SiteConfig {
  name: string;
  baseUrl: string;
  pages: {
    home: string;
    category: string;
    product: string;
    cart: string;
    login: string;
    myAccount: string;
    search: string;
  };
  testData: {
    searchTerm: string;
    cep: string;
    newsletterEmail: string;
  };
  selectors: {
    // Header
    searchInput: string;
    searchButton: string;
    menuNav: string;
    menuLinks: string;
    cartButton: string;
    loginButton: string;
    geoButton: string;

    // Product Listing (PLP)
    productCard: string;
    productCardLink: string;
    productCardTitle: string;
    productCardPrice: string;
    sortSelect: string;
    filtersContainer: string;
    filterGroup: string;
    paginationNext: string;

    // Product Detail (PDP)
    pdpTitle: string;
    pdpPrice: string;
    pdpImage: string;
    addToCartButton: string;
    quantityInput: string;
    quantityPlus: string;
    quantityMinus: string;
    skuSelector: string;
    wishlistButton: string;

    // Cart / Minicart
    minicartOverlay: string;
    cartItemName: string;
    cartItemQuantity: string;
    cartItemRemove: string;
    couponInput: string;
    couponButton: string;
    checkoutButton: string;

    // Newsletter
    newsletterInput: string;
    newsletterButton: string;

    // Chat
    chatWidget: string;

    // Footer
    footer: string;
    footerLinks: string;
  };
  skip: string[];
}

const DEFAULT_SELECTORS: SiteConfig["selectors"] = {
  // Header
  searchInput: 'input[placeholder*="Buscar"], input[type="search"], [data-search-input]',
  searchButton: 'button[type="submit"]:near(input[placeholder*="Buscar"]), button:has-text("Search")',
  menuNav: "header nav, nav[role='navigation'], [data-menu]",
  menuLinks: "header nav a, nav[role='navigation'] a",
  cartButton: 'button:has-text("open cart"), [data-cart-button], button[aria-label*="cart"]',
  loginButton: 'button:has-text("Entre ou cadastre-se"), a[href*="login"], [data-login]',
  geoButton: 'button:has-text("Ver ofertas para a região"), button:has-text("CEP"), [data-geo]',

  // PLP
  productCard: "a:has(h2), a:has(h3), [data-product-card]",
  productCardLink: "a[href*='/p']",
  productCardTitle: "h2, h3, [data-product-title]",
  productCardPrice: "[data-price], :text-matches('R\\$')",
  sortSelect: 'select, combobox, [data-sort]',
  filtersContainer: "aside, [role='complementary'], [data-filters]",
  filterGroup: "aside li, [role='complementary'] li",
  paginationNext: 'a:has-text("next"), a[aria-label*="next"], a:has-text(">")',

  // PDP
  pdpTitle: "h1, [data-product-name]",
  pdpPrice: ":text-matches('R\\$'), [data-price]",
  pdpImage: "img[data-product-image], section img, [data-gallery] img",
  addToCartButton: 'button:has-text("Comprar"), button:has-text("Adicionar"), [data-add-to-cart]',
  quantityInput: 'input[type="number"], input[aria-label*="Quantidade"], [data-quantity]',
  quantityPlus: 'button:has-text("Aumentar"), button:has-text("+"), [data-quantity-plus]',
  quantityMinus: 'button:has-text("Diminuir"), button:has-text("-"), [data-quantity-minus]',
  skuSelector: "[data-sku-selector], [data-variation], .sku-selector",
  wishlistButton: 'button:has-text("wishlist"), button[aria-label*="wishlist"], [data-wishlist]',

  // Cart
  minicartOverlay: "[data-minicart], [data-cart-drawer], [role='dialog']",
  cartItemName: "[data-cart-item] h3, [data-cart-item] h4, [data-item-name]",
  cartItemQuantity: "[data-cart-item] input[type='number'], [data-item-quantity]",
  cartItemRemove: "[data-cart-item] button[aria-label*='remove'], [data-remove-item], button:has-text('Remover')",
  couponInput: "input[name='coupon'], input[placeholder*='cupom'], [data-coupon-input]",
  couponButton: "button:has-text('Aplicar'), [data-coupon-button]",
  checkoutButton: "a:has-text('Finalizar'), button:has-text('Finalizar'), [data-checkout]",

  // Newsletter
  newsletterInput: 'input[placeholder*="e-mail"], input[placeholder*="Email"], input[type="email"], [data-newsletter] input',
  newsletterButton: 'button:has-text("Cadastrar"), button:has-text("Inscrever"), [data-newsletter] button[type="submit"]',

  // Chat
  chatWidget: "iframe[src*='chat'], [class*='chat-widget'], [id*='chat'], [data-chat]",

  // Footer
  footer: "footer, [role='contentinfo']",
  footerLinks: "footer a, [role='contentinfo'] a",
};

const DEFAULT_PAGES: SiteConfig["pages"] = {
  home: "/",
  category: "",
  product: "",
  cart: "/checkout",
  login: "/login",
  myAccount: "/my-account",
  search: "/search",
};

const DEFAULT_TEST_DATA: SiteConfig["testData"] = {
  searchTerm: "tv",
  cep: "20040-020",
  newsletterEmail: "teste-qa@example.com",
};

export function loadSiteConfig(siteName?: string): SiteConfig {
  const name = siteName || process.env.SITE;
  if (!name) {
    throw new Error(
      "No site specified. Set SITE env var or pass site name. Example: SITE=casaevideo-tanstack npx playwright test"
    );
  }

  const configPath = path.resolve(__dirname, "..", "sites", `${name}.yml`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Site config not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = parse(raw) as Partial<SiteConfig>;

  if (!parsed.baseUrl) {
    throw new Error(`Site config must have baseUrl defined`);
  }

  return {
    name: parsed.name || name,
    baseUrl: parsed.baseUrl,
    pages: { ...DEFAULT_PAGES, ...parsed.pages },
    testData: { ...DEFAULT_TEST_DATA, ...parsed.testData },
    selectors: { ...DEFAULT_SELECTORS, ...parsed.selectors },
    skip: parsed.skip || [],
  };
}
