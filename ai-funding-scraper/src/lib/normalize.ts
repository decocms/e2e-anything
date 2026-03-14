// ─── Round Type Normalization ───────────────────────────────────

const ROUND_TYPE_MAP: Record<string, string> = {
  "series a": "Series A",
  "series a1": "Series A",
  "series a2": "Series A",
  "series a+": "Series A",
  "series b": "Series B",
  "series b1": "Series B",
  "series b2": "Series B",
  "series b+": "Series B",
  "series c": "Series C",
  "series c1": "Series C",
  "series c+": "Series C",
  "series d": "Series D",
  "series d+": "Series D",
  "series e": "Series E",
  "series e+": "Series E",
  "series f": "Series F",
  "series g": "Series G",
  "series h": "Series H",
  "growth": "Growth",
  "growth equity": "Growth",
  "growth round": "Growth",
  "late stage": "Late Stage",
  "late stage venture": "Late Stage",
  "late-stage venture": "Late Stage",
  "private equity": "Private Equity",
  "pe growth": "Private Equity",
  "corporate round": "Corporate Round",
  "corporate": "Corporate Round",
};

const EXCLUDED_ROUNDS = new Set([
  "seed", "pre-seed", "pre seed", "preseed",
  "angel", "angel round",
  "grant", "non-equity assistance",
  "convertible note", "convertible",
  "debt", "debt financing", "venture debt",
  "bridge", "bridge round",
  "friends and family",
  "crowdfunding", "equity crowdfunding",
  "initial coin offering", "ico",
  "undisclosed", "unknown",
  "product crowdfunding",
]);

export function normalizeRoundType(raw: string): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim().replace(/-/g, " ").replace(/\s+/g, " ");

  if (EXCLUDED_ROUNDS.has(lower)) return null;

  // Direct map lookup
  if (ROUND_TYPE_MAP[lower]) return ROUND_TYPE_MAP[lower];

  // Pattern: "series X" where X is A-Z
  const seriesMatch = lower.match(/^series\s+([a-z])/);
  if (seriesMatch) {
    const letter = seriesMatch[1].toUpperCase();
    // Only include Series A and above
    if (letter >= "A") return `Series ${letter}`;
  }

  // IPO counts as large
  if (lower.includes("ipo") || lower.includes("public offering")) return "IPO";

  // Secondary / mezzanine
  if (lower.includes("mezzanine")) return "Late Stage";
  if (lower.includes("secondary")) return "Secondary";

  return null; // Unknown rounds are excluded
}

/**
 * Returns a numeric rank for round types (higher = later stage)
 */
export function roundTypeRank(normalized: string): number {
  const ranks: Record<string, number> = {
    "Series A": 1,
    "Series B": 2,
    "Series C": 3,
    "Series D": 4,
    "Series E": 5,
    "Series F": 6,
    "Series G": 7,
    "Series H": 8,
    "Growth": 5,
    "Late Stage": 6,
    "Private Equity": 7,
    "Corporate Round": 3,
    "IPO": 10,
    "Secondary": 4,
  };
  return ranks[normalized] ?? 0;
}

// ─── Amount Parsing ─────────────────────────────────────────────

export function parseAmount(raw: string): number | null {
  if (!raw) return null;

  const cleaned = raw.trim().replace(/,/g, "").replace(/\s+/g, " ");

  // Match patterns: "$15M", "$1.2B", "15 million", "$150,000,000", "US$15M"
  const match = cleaned.match(
    /(?:US?\$|€|£)?\s*([\d.]+)\s*(billion|bil|B|million|mil|M|thousand|K|T)?/i
  );

  if (!match) return null;

  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;

  const suffix = (match[2] || "").toLowerCase();

  let multiplier = 1;
  if (suffix === "b" || suffix === "billion" || suffix === "bil") {
    multiplier = 1_000_000_000;
  } else if (suffix === "m" || suffix === "million" || suffix === "mil") {
    multiplier = 1_000_000;
  } else if (suffix === "k" || suffix === "thousand") {
    multiplier = 1_000;
  } else if (suffix === "t") {
    multiplier = 1_000_000_000_000;
  } else if (num > 1000) {
    // Raw number like "150000000" - already in dollars
    multiplier = 1;
  } else if (num > 1) {
    // Ambiguous small number - assume millions (common in headlines)
    multiplier = 1_000_000;
  }

  return num * multiplier;
}

// ─── Date Normalization ─────────────────────────────────────────

export function normalizeDate(raw: string): string {
  if (!raw) return new Date().toISOString().split("T")[0];

  // Already ISO format?
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Try standard Date parsing
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  // Handle formats like "March 15, 2026" or "15 March 2026"
  const months: Record<string, string> = {
    jan: "01", january: "01",
    feb: "02", february: "02",
    mar: "03", march: "03",
    apr: "04", april: "04",
    may: "05",
    jun: "06", june: "06",
    jul: "07", july: "07",
    aug: "08", august: "08",
    sep: "09", september: "09",
    oct: "10", october: "10",
    nov: "11", november: "11",
    dec: "12", december: "12",
  };

  // "March 15, 2026"
  const m1 = raw.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m1) {
    const month = months[m1[1].toLowerCase()];
    if (month) return `${m1[3]}-${month}-${m1[2].padStart(2, "0")}`;
  }

  // "15 March 2026"
  const m2 = raw.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (m2) {
    const month = months[m2[2].toLowerCase()];
    if (month) return `${m2[3]}-${month}-${m2[1].padStart(2, "0")}`;
  }

  // Fallback
  return new Date().toISOString().split("T")[0];
}

// ─── Domain Extraction ──────────────────────────────────────────

export function extractDomain(url: string): string | null {
  if (!url) return null;
  try {
    let u = url.trim();
    if (!u.startsWith("http")) u = `https://${u}`;
    const parsed = new URL(u);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// ─── Name Normalization ─────────────────────────────────────────

const COMPANY_SUFFIXES = /\s*(?:inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|incorporated|limited|corporation|gmbh|s\.?a\.?|b\.?v\.?|pte\.?\s*ltd\.?|pty\.?\s*ltd\.?|plc\.?)$/i;

export function normalizeName(name: string): string {
  return name
    .trim()
    .replace(COMPANY_SUFFIXES, "")
    .replace(/[^\w\s.-]/g, "") // Remove special chars except dots, hyphens
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
