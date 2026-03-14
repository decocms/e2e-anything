/**
 * Classify whether a job title/description is a sales role
 * and extract recruiter info from job posting text.
 */

// Sales-related title keywords (case-insensitive matching)
const SALES_TITLE_KEYWORDS = [
  "sales",
  "account executive",
  "account manager",
  "business development",
  "bdr",
  "sdr",
  "sales development",
  "sales engineer",
  "sales manager",
  "sales director",
  "sales lead",
  "vp of sales",
  "vp sales",
  "head of sales",
  "chief revenue",
  "cro",
  "revenue",
  "go-to-market",
  "gtm",
  "enterprise sales",
  "inside sales",
  "field sales",
  "regional sales",
  "commercial",
  "partnerships",
  "partner manager",
  "channel sales",
  "solutions engineer",
  "solutions consultant",
  "pre-sales",
  "presales",
  "customer success",
  "client success",
  "customer acquisition",
];

// Terms that disqualify a job even if "sales" appears
const SALES_NEGATIVE_KEYWORDS = [
  "after-sales support engineer",
  "point of sale developer",
  "salesforce developer",
  "salesforce admin",
  "salesforce engineer",
];

export function isSalesRole(title: string, description?: string | null): boolean {
  const titleLower = title.toLowerCase();

  // Check negative keywords first
  for (const neg of SALES_NEGATIVE_KEYWORDS) {
    if (titleLower.includes(neg)) return false;
  }

  // Check title
  for (const keyword of SALES_TITLE_KEYWORDS) {
    if (titleLower.includes(keyword)) return true;
  }

  // Check department indicators in description
  if (description) {
    const descLower = description.toLowerCase();
    const salesDescSignals = [
      "sales quota",
      "pipeline",
      "close deals",
      "revenue target",
      "sales cycle",
      "prospecting",
      "outbound",
      "inbound leads",
      "crm",
      "hubspot",
      "salesforce",
      "cold calling",
      "cold email",
      "demo",
      "quota attainment",
      "sales team",
      "book meetings",
      "generate leads",
    ];

    let matches = 0;
    for (const signal of salesDescSignals) {
      if (descLower.includes(signal)) matches++;
    }
    // Need at least 2 description signals if title didn't match
    if (matches >= 2) return true;
  }

  return false;
}

export function classifyDepartment(title: string): string | null {
  const lower = title.toLowerCase();

  if (lower.includes("sdr") || lower.includes("sales development") || lower.includes("bdr") || lower.includes("business development")) {
    return "Sales Development";
  }
  if (lower.includes("account executive") || lower.includes("ae ")) {
    return "Account Executive";
  }
  if (lower.includes("account manager") || lower.includes("customer success") || lower.includes("client success")) {
    return "Account Management";
  }
  if (lower.includes("sales engineer") || lower.includes("solutions engineer") || lower.includes("pre-sales") || lower.includes("presales")) {
    return "Sales Engineering";
  }
  if (lower.includes("sales manager") || lower.includes("sales director") || lower.includes("head of sales") || lower.includes("vp")) {
    return "Sales Leadership";
  }
  if (lower.includes("partnership") || lower.includes("channel") || lower.includes("alliances")) {
    return "Partnerships";
  }
  if (lower.includes("revenue") || lower.includes("gtm") || lower.includes("go-to-market")) {
    return "Revenue / GTM";
  }

  return "Sales";
}

// ─── Recruiter Extraction ────────────────────────────────────────

export interface RecruiterInfo {
  name: string | null;
  title: string | null;
  email: string | null;
  linkedin: string | null;
  phone: string | null;
}

/**
 * Extract recruiter info from a job posting page text.
 * Looks for common patterns in job postings.
 */
export function extractRecruiterInfo(text: string): RecruiterInfo {
  const info: RecruiterInfo = {
    name: null,
    title: null,
    email: null,
    linkedin: null,
    phone: null,
  };

  // Extract email addresses
  const emailPattern = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
  const emails = [...text.matchAll(emailPattern)].map(m => m[1]);
  // Filter out generic emails
  const recruiterEmail = emails.find(e => {
    const local = e.split("@")[0].toLowerCase();
    return !["info", "support", "hello", "contact", "team", "admin", "noreply", "no-reply", "privacy", "legal", "security"].includes(local);
  });
  if (recruiterEmail) info.email = recruiterEmail;

  // Extract LinkedIn URLs
  const linkedinPattern = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)\/?/g;
  const linkedinMatch = linkedinPattern.exec(text);
  if (linkedinMatch) info.linkedin = `https://linkedin.com/in/${linkedinMatch[1]}`;

  // Extract phone numbers
  const phonePattern = /(?:\+?1?[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;
  const phoneMatch = phonePattern.exec(text);
  if (phoneMatch) info.phone = phoneMatch[0].trim();

  // Look for recruiter/contact patterns
  // IMPORTANT: Must validate the extracted name is a real person name
  const recruiterPatterns = [
    // "Contact: John Smith" or "Recruiter: Jane Doe"
    /(?:recruiter|hiring manager|posted by|point of contact)[:\s]+([A-Z][a-z]{1,15} [A-Z][a-z]{1,15}(?:\s[A-Z][a-z]{1,15})?)\b/,
    // "For questions, reach out to John Smith"
    /(?:reach out to|questions\??\s*contact)\s+([A-Z][a-z]{1,15} [A-Z][a-z]{1,15}(?:\s[A-Z][a-z]{1,15})?)\b/,
    // "Jane Smith, Talent Acquisition" or "Jane Smith - Recruiter"
    /([A-Z][a-z]{1,15} [A-Z][a-z]{1,15}(?:\s[A-Z][a-z]{1,15})?)\s*[,\u2013-]\s*(?:Recruiter|Talent Acquisition|Hiring Manager|People Operations|HR Manager)/,
  ];

  for (const pattern of recruiterPatterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const candidate = match[1].trim();
      // Validate: must be 2-3 words, each 2-15 chars, no common non-name words
      const words = candidate.split(/\s+/);
      const invalidWords = ["the", "and", "for", "with", "from", "this", "that", "your", "our", "their",
        "digital", "channel", "sales", "about", "more", "than", "have", "been", "will", "not",
        "shortages", "worsen", "partners", "advertising", "company", "senior", "junior", "lead",
        "remote", "hybrid", "based"];
      const isValid = words.length >= 2 && words.length <= 3 &&
        words.every(w => w.length >= 2 && w.length <= 15) &&
        !words.some(w => invalidWords.includes(w.toLowerCase()));
      if (isValid) {
        info.name = candidate;
        break;
      }
    }
  }

  // Look for recruiter title
  const titlePatterns = [
    /(?:recruiter|hiring manager|talent acquisition|people operations|hr manager|head of talent|head of people|vp people|director.*talent)/i,
  ];

  for (const pattern of titlePatterns) {
    const match = pattern.exec(text);
    if (match) {
      info.title = match[0].trim();
      break;
    }
  }

  return info;
}

/**
 * Extract recruiter info from structured job listing data (e.g., Greenhouse, Lever API responses)
 */
export function extractRecruiterFromStructuredData(data: any): RecruiterInfo {
  const info: RecruiterInfo = {
    name: null,
    title: null,
    email: null,
    linkedin: null,
    phone: null,
  };

  // Greenhouse API format
  if (data.hiring_team) {
    const recruiters = data.hiring_team.filter((p: any) =>
      p.role?.toLowerCase().includes("recruiter") ||
      p.role?.toLowerCase().includes("talent") ||
      p.role?.toLowerCase().includes("coordinator")
    );
    if (recruiters.length > 0) {
      info.name = recruiters[0].name;
      info.title = recruiters[0].role;
      info.email = recruiters[0].email;
    }
  }

  // Lever format
  if (data.additional) {
    const hiringManager = data.additional.find((a: any) =>
      a.label?.toLowerCase().includes("hiring manager") ||
      a.label?.toLowerCase().includes("recruiter")
    );
    if (hiringManager) {
      info.name = hiringManager.value;
    }
  }

  return info;
}
