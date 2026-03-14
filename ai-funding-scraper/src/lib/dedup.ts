import { Database } from "bun:sqlite";
import { normalizeName, extractDomain } from "./normalize";
import type { Company } from "../db/queries";
import {
  findCompanyByDomain,
  findCompanyByNormalizedName,
  findCompaniesByNamePrefix,
} from "../db/queries";

// ─── String Similarity ──────────────────────────────────────────

function bigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/\s+/g, "");
  const result = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    result.add(s.slice(i, i + 2));
  }
  return result;
}

export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  let intersection = 0;

  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

const FUZZY_THRESHOLD = 0.85;

// ─── Company Matching ───────────────────────────────────────────

export interface MatchResult {
  id: number;
  company: Company;
  matchType: "exact_domain" | "exact_name" | "fuzzy_name";
  confidence: number;
}

export function findMatchingCompany(
  db: Database,
  name: string,
  website?: string | null
): MatchResult | null {
  const normalizedName = normalizeName(name);
  const domain = website ? extractDomain(website) : null;

  // 1. Exact domain match (strongest signal)
  if (domain) {
    const byDomain = findCompanyByDomain(db, domain);
    if (byDomain) {
      return {
        id: byDomain.id,
        company: byDomain,
        matchType: "exact_domain",
        confidence: 1.0,
      };
    }
  }

  // 2. Exact normalized name match
  const byName = findCompanyByNormalizedName(db, normalizedName);
  if (byName) {
    return {
      id: byName.id,
      company: byName,
      matchType: "exact_name",
      confidence: 0.95,
    };
  }

  // 3. Fuzzy name match — check companies with same prefix
  const prefix = normalizedName.slice(0, 3);
  if (prefix.length >= 3) {
    const candidates = findCompaniesByNamePrefix(db, prefix);
    let bestMatch: MatchResult | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const score = diceCoefficient(normalizedName, candidate.normalized_name);
      if (score >= FUZZY_THRESHOLD && score > bestScore) {
        bestScore = score;
        bestMatch = {
          id: candidate.id,
          company: candidate,
          matchType: "fuzzy_name",
          confidence: score,
        };
      }
    }

    if (bestMatch) return bestMatch;
  }

  return null;
}

// ─── Source Merging ──────────────────────────────────────────────

export function mergeSources(existing: string, newSource: string): string {
  try {
    const sources: string[] = JSON.parse(existing);
    if (!sources.includes(newSource)) {
      sources.push(newSource);
    }
    return JSON.stringify(sources);
  } catch {
    return JSON.stringify([newSource]);
  }
}

/**
 * Returns an update object with fields that should be updated (non-null new values
 * that replace null existing values — never overwrite existing data)
 */
export function mergeCompanyFields(
  existing: Company,
  newData: {
    description?: string | null;
    website?: string | null;
    domain?: string | null;
    founded_year?: number | null;
    hq_location?: string | null;
    hq_country?: string | null;
    sectors?: string;
    logo_url?: string | null;
    employee_count?: string | null;
    yc_batch?: string | null;
    is_ai_native?: number;
  }
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  // Fill in blanks — don't overwrite existing data
  if (!existing.description && newData.description) updates.description = newData.description;
  if (!existing.website && newData.website) updates.website = newData.website;
  if (!existing.domain && newData.domain) updates.domain = newData.domain;
  if (!existing.founded_year && newData.founded_year) updates.founded_year = newData.founded_year;
  if (!existing.hq_location && newData.hq_location) updates.hq_location = newData.hq_location;
  if (!existing.hq_country && newData.hq_country) updates.hq_country = newData.hq_country;
  if (!existing.logo_url && newData.logo_url) updates.logo_url = newData.logo_url;
  if (!existing.employee_count && newData.employee_count) updates.employee_count = newData.employee_count;
  if (!existing.yc_batch && newData.yc_batch) updates.yc_batch = newData.yc_batch;

  // Promote to AI-native if newly classified
  if (!existing.is_ai_native && newData.is_ai_native) updates.is_ai_native = 1;

  // Merge sectors
  if (newData.sectors) {
    try {
      const existingSectors: string[] = JSON.parse(existing.sectors || "[]");
      const newSectors: string[] = JSON.parse(newData.sectors);
      const merged = [...new Set([...existingSectors, ...newSectors])];
      if (merged.length > existingSectors.length) {
        updates.sectors = JSON.stringify(merged);
      }
    } catch { /* ignore */ }
  }

  return updates;
}
