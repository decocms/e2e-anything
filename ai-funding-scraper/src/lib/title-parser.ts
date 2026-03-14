/**
 * Parse funding information from news headlines.
 * Handles patterns like:
 *   "Company X raises $15M Series A"
 *   "Company X secures $1.2 billion Series B led by Investor Y"
 *   "Company X closes $50M in Series C funding"
 *   "Company X, an AI startup, raises $100M at $2B valuation"
 */

export interface ParsedTitle {
  companyName: string;
  amount: string | null;
  roundType: string | null;
  investors: string[];
  valuation: string | null;
}

// Funding verbs
const VERBS = "raises?|raised|closes?|closed|lands?|landed|secures?|secured|gets?|got|nabs?|nabbed|snags?|snagged|bags?|bagged|nets?|netted|banks?|banked|pulls?|pulled|hauls?|hauled|announces?|announced|receives?|received";

// Round types pattern
const ROUND_TYPES = "Series\\s+[A-H]\\+?|seed|growth|late[- ]stage|private\\s+equity|mezzanine|venture|funding\\s+round";

// Amount pattern: $15M, $1.2B, $100 million, etc.
const AMOUNT = "\\$[\\d,.]+\\s*(?:billion|bil|B|million|mil|M|thousand|K)?|\\$[\\d,.]+";

/**
 * Parse a news headline for funding information
 */
export function parseFundingTitle(title: string): ParsedTitle | null {
  if (!title) return null;

  const clean = title.replace(/\s+/g, " ").trim();

  // Pattern 1: "{Company} raises $X {Round}"
  const p1 = new RegExp(
    `^(.+?)\\s+(?:${VERBS})\\s+(${AMOUNT})(?:\\s+(?:in\\s+)?(?:a\\s+)?(${ROUND_TYPES}))?`,
    "i"
  );
  const m1 = clean.match(p1);
  if (m1) {
    return buildResult(m1[1], m1[2], m1[3] || null, clean);
  }

  // Pattern 2: "{Company} announces $X {Round} funding"
  const p2 = new RegExp(
    `^(.+?)\\s+(?:announces?|reveals?)\\s+(${AMOUNT})\\s+(?:in\\s+)?(${ROUND_TYPES})`,
    "i"
  );
  const m2 = clean.match(p2);
  if (m2) {
    return buildResult(m2[1], m2[2], m2[3], clean);
  }

  // Pattern 3: "{Company}, {description}, raises $X"
  const p3 = new RegExp(
    `^(.+?),\\s+(?:an?\\s+)?[^,]+,\\s+(?:${VERBS})\\s+(${AMOUNT})(?:\\s+(?:in\\s+)?(?:a\\s+)?(${ROUND_TYPES}))?`,
    "i"
  );
  const m3 = clean.match(p3);
  if (m3) {
    return buildResult(m3[1], m3[2], m3[3] || null, clean);
  }

  // Pattern 4: "{Round}: {Company} raises $X"
  const p4 = new RegExp(
    `^(${ROUND_TYPES}):\\s+(.+?)\\s+(?:${VERBS})\\s+(${AMOUNT})`,
    "i"
  );
  const m4 = clean.match(p4);
  if (m4) {
    return buildResult(m4[2], m4[3], m4[1], clean);
  }

  return null;
}

function buildResult(
  rawName: string,
  amount: string | null,
  roundType: string | null,
  fullTitle: string
): ParsedTitle {
  // Clean up company name
  let companyName = rawName.trim()
    .replace(/^["']|["']$/g, "")  // Remove quotes
    .replace(/\s*[-–—:]\s*$/, "")  // Remove trailing dashes
    .replace(/\s+/g, " ")
    .replace(/^\d+\.?\s*(?:\(tied\)\s*)?/i, "")  // Remove "2. (tied) " numbering
    .replace(/^(?:exclusive|breaking|update|report):\s*/i, ""); // Remove "Exclusive:"

  // Remove common prefixes like "AI startup X" or "Agentic finance automation startup X"
  companyName = companyName
    .replace(/^(?:AI|agentic|autonomous|generative\s+ai|machine\s+learning)\s+[\w\s]+?(?:startup|company|firm|platform|provider)\s+/i, "")
    .replace(/^(?:startup|fintech|healthtech|edtech|biotech|deeptech|cleantech|medtech|agtech|proptech|insurtech|legaltech|regtech)\s+/i, "")
    .replace(/^(?:AI startup|AI company)\s+/i, "");

  // Remove descriptive suffixes like ", an AI platform built for..."
  companyName = companyName
    .replace(/,\s+(?:a|an|the|another)\s+.*/i, "")  // ", an AI platform..."
    .replace(/,\s+which\s+.*/i, "")            // ", which does..."
    .replace(/,\s+(?:led|backed|founded)\s+.*/i, "")  // ", led by..."
    .replace(/,\s+\$[\d,.]+[BMK]?\s*,.*/i, "")  // ", $500M, AI infrastructure: ..."
    .replace(/,\s+\$[\d,.]+.*/i, "")           // ", $500M..."
    .replace(/\s+has$/i, "")                   // trailing "has"
    .replace(/\s+is$/i, "")                    // trailing "is"
    .replace(/\s*[-–—]\s+.*$/, "")             // "Name — description"
    .replace(/:\s+\w+.*$/, "")                 // ": description text"
    .replace(/,\s*$/, "")                       // trailing comma
    .replace(/\.\s*$/, "")                      // trailing period
    .replace(/^(?:This week,?\s*)?(?:Dutch|French|German|British|US|UK|Israeli|Indian|Japanese|Korean|Chinese|Canadian|Australian|Brazilian|Mexican|Singapore|Swedish|Finnish|Norwegian|Danish|Swiss)\s+(?:startup|company)\s+/i, "")  // "Dutch startup Vitestro"
    .trim();

  // Extract investors from "led by" pattern
  const investors: string[] = [];
  const ledByMatch = fullTitle.match(
    /(?:led|headed)\s+by\s+([^,.]+(?:\s+and\s+[^,.]+)?)/i
  );
  if (ledByMatch) {
    const investorStr = ledByMatch[1];
    investors.push(
      ...investorStr.split(/\s+and\s+|\s*,\s*/).map((s) => s.trim()).filter(Boolean)
    );
  }

  // Check for "with participation from"
  const partMatch = fullTitle.match(
    /(?:with\s+)?participation\s+(?:from|by)\s+([^.]+)/i
  );
  if (partMatch) {
    investors.push(
      ...partMatch[1].split(/\s+and\s+|\s*,\s*/).map((s) => s.trim()).filter(Boolean)
    );
  }

  // Extract valuation
  let valuation: string | null = null;
  const valMatch = fullTitle.match(
    /(?:at|with)\s+(?:a\s+)?\$([\d,.]+)\s*(?:billion|B|million|M)\s+valuation/i
  );
  if (valMatch) {
    valuation = "$" + valMatch[1] + (fullTitle.match(/billion|B/i) ? "B" : "M");
  }

  return {
    companyName,
    amount: amount || null,
    roundType: roundType?.trim() || null,
    investors: [...new Set(investors)],
    valuation,
  };
}

/**
 * Try to extract round type from article description/body
 * when the title didn't include it
 */
export function extractRoundFromText(text: string): string | null {
  const roundMatch = text.match(
    /(?:Series\s+[A-H]\+?|seed\s+round|growth\s+round|late[- ]stage)/i
  );
  return roundMatch ? roundMatch[0] : null;
}

/**
 * Try to extract funding amount from text
 */
export function extractAmountFromText(text: string): string | null {
  const amountMatch = text.match(
    /\$([\d,.]+)\s*(?:billion|bil|B|million|mil|M|thousand|K)/i
  );
  return amountMatch ? amountMatch[0] : null;
}
