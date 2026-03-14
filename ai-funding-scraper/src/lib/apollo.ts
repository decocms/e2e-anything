/**
 * Apollo.io API client
 *
 * - People Match: find verified emails for a person by name + domain or LinkedIn URL
 * - People Search: find people at a company by domain + job title filters
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY || "";
const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

// Rate limit: ~600 calls/hour = 10/min. Stay conservative.
const MIN_DELAY_MS = 400;
let lastCallAt = 0;

export interface ApolloPersonMatch {
  email: string | null;
  emailStatus: "verified" | "unverified" | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  organizationName: string | null;
}

/**
 * Enrich a person via Apollo's People Match API.
 * Accepts name + domain, or a LinkedIn URL.
 */
export async function enrichPerson(opts: {
  firstName?: string;
  lastName?: string;
  name?: string;
  domain?: string;
  organizationName?: string;
  linkedinUrl?: string;
}): Promise<ApolloPersonMatch | null> {
  if (!APOLLO_API_KEY) {
    console.warn("[apollo] No APOLLO_API_KEY set, skipping enrichment");
    return null;
  }

  // Rate limit
  const now = Date.now();
  const elapsed = now - lastCallAt;
  if (elapsed < MIN_DELAY_MS) {
    await Bun.sleep(MIN_DELAY_MS - elapsed);
  }
  lastCallAt = Date.now();

  const params = new URLSearchParams();

  if (opts.firstName) params.set("first_name", opts.firstName);
  if (opts.lastName) params.set("last_name", opts.lastName);
  if (opts.name && !opts.firstName) params.set("name", opts.name);
  if (opts.domain) params.set("domain", opts.domain);
  if (opts.organizationName) params.set("organization_name", opts.organizationName);
  if (opts.linkedinUrl) params.set("linkedin_url", opts.linkedinUrl);

  try {
    const res = await fetch(`${APOLLO_BASE_URL}/people/match?${params}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APOLLO_API_KEY,
      },
    });

    if (res.status === 429) {
      console.warn("[apollo] Rate limited, backing off 30s...");
      await Bun.sleep(30_000);
      return null;
    }

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[apollo] API error ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as {
      person?: {
        email?: string;
        email_status?: string;
        first_name?: string;
        last_name?: string;
        title?: string;
        linkedin_url?: string;
        phone_numbers?: { sanitized_number?: string }[];
        city?: string;
        country?: string;
        organization?: { name?: string };
      };
    };

    if (!data.person) return null;

    const p = data.person;
    return {
      email: p.email || null,
      emailStatus: (p.email_status === "verified" || p.email_status === "unverified")
        ? p.email_status
        : null,
      firstName: p.first_name || null,
      lastName: p.last_name || null,
      title: p.title || null,
      linkedinUrl: p.linkedin_url || null,
      phone: p.phone_numbers?.[0]?.sanitized_number || null,
      city: p.city || null,
      country: p.country || null,
      organizationName: p.organization?.name || null,
    };
  } catch (err) {
    console.warn("[apollo] Request failed:", (err as Error).message);
    return null;
  }
}

/**
 * Bulk enrich up to 10 people at once.
 */
export async function enrichPeopleBulk(
  people: {
    firstName?: string;
    lastName?: string;
    name?: string;
    domain?: string;
    organizationName?: string;
    linkedinUrl?: string;
  }[]
): Promise<(ApolloPersonMatch | null)[]> {
  if (!APOLLO_API_KEY) return people.map(() => null);

  const now = Date.now();
  const elapsed = now - lastCallAt;
  if (elapsed < MIN_DELAY_MS) {
    await Bun.sleep(MIN_DELAY_MS - elapsed);
  }
  lastCallAt = Date.now();

  const details = people.map((p) => ({
    first_name: p.firstName,
    last_name: p.lastName,
    name: !p.firstName ? p.name : undefined,
    domain: p.domain,
    organization_name: p.organizationName,
    linkedin_url: p.linkedinUrl,
  }));

  try {
    const res = await fetch(`${APOLLO_BASE_URL}/people/bulk_match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APOLLO_API_KEY,
      },
      body: JSON.stringify({ details }),
    });

    if (res.status === 429) {
      console.warn("[apollo] Rate limited on bulk, backing off 30s...");
      await Bun.sleep(30_000);
      return people.map(() => null);
    }

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[apollo] Bulk API error ${res.status}: ${text.slice(0, 200)}`);
      return people.map(() => null);
    }

    const data = await res.json() as {
      matches?: ({
        email?: string;
        email_status?: string;
        first_name?: string;
        last_name?: string;
        title?: string;
        linkedin_url?: string;
        phone_numbers?: { sanitized_number?: string }[];
        city?: string;
        country?: string;
        organization?: { name?: string };
      } | null)[];
    };

    return (data.matches || []).map((p) => {
      if (!p) return null;
      return {
        email: p.email || null,
        emailStatus: (p.email_status === "verified" || p.email_status === "unverified")
          ? p.email_status
          : null,
        firstName: p.first_name || null,
        lastName: p.last_name || null,
        title: p.title || null,
        linkedinUrl: p.linkedin_url || null,
        phone: p.phone_numbers?.[0]?.sanitized_number || null,
        city: p.city || null,
        country: p.country || null,
        organizationName: p.organization?.name || null,
      };
    });
  } catch (err) {
    console.warn("[apollo] Bulk request failed:", (err as Error).message);
    return people.map(() => null);
  }
}

export function isApolloConfigured(): boolean {
  return !!APOLLO_API_KEY;
}

// ─── People Search API ──────────────────────────────────────────

export interface ApolloSearchResult {
  apolloId: string;
  firstName: string | null;
  title: string | null;
  organizationName: string | null;
}

/**
 * Search for people at a specific company domain with title filters.
 * Uses Apollo's /mixed_people/api_search endpoint.
 *
 * Returns partial data (first name, title, Apollo ID).
 * Use enrichById() to get full names, emails, and LinkedIn URLs.
 */
export async function searchPeopleAtDomain(opts: {
  domain: string;
  titles: string[];
  perPage?: number;
  page?: number;
}): Promise<ApolloSearchResult[]> {
  if (!APOLLO_API_KEY) {
    console.warn("[apollo] No APOLLO_API_KEY set, skipping search");
    return [];
  }

  const now = Date.now();
  const elapsed = now - lastCallAt;
  if (elapsed < MIN_DELAY_MS) {
    await Bun.sleep(MIN_DELAY_MS - elapsed);
  }
  lastCallAt = Date.now();

  try {
    const res = await fetch(`${APOLLO_BASE_URL}/mixed_people/api_search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APOLLO_API_KEY,
      },
      body: JSON.stringify({
        q_organization_domains: opts.domain,
        person_titles: opts.titles,
        per_page: opts.perPage ?? 25,
        page: opts.page ?? 1,
      }),
    });

    if (res.status === 429) {
      console.warn("[apollo] Rate limited on search, backing off 30s...");
      await Bun.sleep(30_000);
      return [];
    }

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[apollo] Search API error ${res.status}: ${text.slice(0, 200)}`);
      return [];
    }

    const data = await res.json() as {
      people?: {
        id?: string;
        first_name?: string;
        title?: string;
        organization?: { name?: string };
      }[];
    };

    return (data.people || [])
      .filter((p) => p.id && p.first_name)
      .map((p) => ({
        apolloId: p.id!,
        firstName: p.first_name || null,
        title: p.title || null,
        organizationName: p.organization?.name || null,
      }));
  } catch (err) {
    console.warn("[apollo] Search request failed:", (err as Error).message);
    return [];
  }
}

/**
 * Enrich a person by Apollo ID to get full name, email, and LinkedIn.
 * Uses the /people/match endpoint with the id parameter.
 */
export async function enrichById(apolloId: string): Promise<ApolloPersonMatch | null> {
  if (!APOLLO_API_KEY) return null;

  const now = Date.now();
  const elapsed = now - lastCallAt;
  if (elapsed < MIN_DELAY_MS) {
    await Bun.sleep(MIN_DELAY_MS - elapsed);
  }
  lastCallAt = Date.now();

  try {
    const res = await fetch(`${APOLLO_BASE_URL}/people/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APOLLO_API_KEY,
      },
      body: JSON.stringify({ id: apolloId }),
    });

    if (res.status === 429) {
      console.warn("[apollo] Rate limited on enrichById, backing off 30s...");
      await Bun.sleep(30_000);
      return null;
    }

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[apollo] enrichById error ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as {
      person?: {
        email?: string;
        email_status?: string;
        first_name?: string;
        last_name?: string;
        title?: string;
        linkedin_url?: string;
        phone_numbers?: { sanitized_number?: string }[];
        city?: string;
        country?: string;
        organization?: { name?: string };
      };
    };

    if (!data.person) return null;

    const p = data.person;
    return {
      email: p.email || null,
      emailStatus: (p.email_status === "verified" || p.email_status === "unverified")
        ? p.email_status : null,
      firstName: p.first_name || null,
      lastName: p.last_name || null,
      title: p.title || null,
      linkedinUrl: p.linkedin_url || null,
      phone: p.phone_numbers?.[0]?.sanitized_number || null,
      city: p.city || null,
      country: p.country || null,
      organizationName: p.organization?.name || null,
    };
  } catch (err) {
    console.warn("[apollo] enrichById failed:", (err as Error).message);
    return null;
  }
}
