/**
 * Outreach email templates with timeliness-aware personalization.
 */

export interface OutreachData {
  recruiterName: string;
  recruiterFirstName: string;
  recruiterEmail: string;
  emailVerified: boolean;
  linkedinUrl: string | null;
  companyName: string;
  companyDomain: string | null;
  companyDescription: string | null;
  companySectors: string[];
  companyLocation: string | null;
  employeeCount: string | null;
  roundType: string | null;
  amountUsd: number | null;
  announcedDate: string | null;
  leadInvestors: string[];
  salesRoles: string[];
  salesJobCount: number;
}

type Recency = "fresh" | "recent" | "older";
type Stage = "series-a" | "growth";

function getRecency(announcedDate: string | null): Recency {
  if (!announcedDate) return "older";
  const days = Math.floor(
    (Date.now() - new Date(announcedDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (days <= 7) return "fresh";
  if (days <= 30) return "recent";
  return "older";
}

function getStage(roundType: string | null): Stage {
  if (!roundType) return "growth";
  const lower = roundType.toLowerCase();
  if (lower.includes("series a") || lower.includes("seed")) return "series-a";
  return "growth";
}

function formatAmount(amount: number | null): string {
  if (!amount) return "";
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(0)}M`;
  return `$${(amount / 1e3).toFixed(0)}K`;
}

function formatMonth(date: string): string {
  return new Date(date).toLocaleDateString("en-US", { month: "long" });
}

function formatRolesNaturally(roles: string[]): string {
  if (roles.length === 0) return "sales roles";
  if (roles.length === 1) return `a ${roles[0]}`;
  if (roles.length === 2) return `a ${roles[0]} and ${roles[1]}`;
  return `${roles.length} sales roles including ${roles[0]}`;
}

// ─── Subject Lines ─────────────────────────────────────────────

export function generateSubject(data: OutreachData): string {
  const recency = getRecency(data.announcedDate);
  const amount = formatAmount(data.amountUsd);

  switch (recency) {
    case "fresh":
      return amount
        ? `${data.companyName} just raised ${amount} — I can help you get to the next level`
        : `${data.companyName} just raised — I can help you get to the next level`;
    case "recent":
      return `${data.companyName}'s ${data.roundType || "round"} — I can help you get to the next level`;
    case "older":
      return `${data.companyName} is scaling — I can help you get to the next level`;
  }
}

// ─── Email Bodies ──────────────────────────────────────────────

export function generateBody(data: OutreachData): string {
  const recency = getRecency(data.announcedDate);
  const stage = getStage(data.roundType);
  const amount = formatAmount(data.amountUsd);
  const roles = formatRolesNaturally(data.salesRoles);

  const hook = buildHook(data, recency, amount);
  const bridge = buildBridge(data, stage, roles);
  const differentiator = buildDifferentiator(data);
  const cta = `Worth a 15-min call this week?`;
  const sign = `Leandro`;

  return [hook, "", bridge, "", differentiator, "", cta, "", sign].join("\n");
}

function buildHook(data: OutreachData, recency: Recency, amount: string): string {
  const { recruiterFirstName, companyName, roundType, announcedDate } = data;

  switch (recency) {
    case "fresh":
      return amount
        ? `Hi ${recruiterFirstName},\n\nI saw ${companyName} just closed its ${roundType} (${amount}). Congrats — I can help you get to the next level.`
        : `Hi ${recruiterFirstName},\n\nI saw ${companyName} just closed its ${roundType}. Congrats — I can help you get to the next level.`;
    case "recent":
      return `Hi ${recruiterFirstName},\n\nCongrats on ${companyName}'s ${roundType}${amount ? ` (${amount})` : ""} last month. I can help you get to the next level.`;
    case "older":
      return `Hi ${recruiterFirstName},\n\nSince ${companyName}'s ${roundType || "round"}${announcedDate ? ` in ${formatMonth(announcedDate)}` : ""}, I can help you get to the next level.`;
  }
}

function buildBridge(data: OutreachData, stage: Stage, roles: string): string {
  const hiringLine = data.salesJobCount > 0
    ? `I noticed you're hiring ${roles}. `
    : "";

  if (stage === "series-a") {
    return `${hiringLine}I've been the first GTM hire before. At deco.cx I grew the company to $2M ARR, built a 30+ SI partner ecosystem, and sold our AI platform to enterprises like Cogna and Superfrete. I also founded and exited my own company.`;
  }

  return `${hiringLine}I've built GTM engines from scratch. At deco.cx I was the first sales hire — grew it to $2M ARR, built a 30+ partner ecosystem, and sold our AI platform to enterprises. I also founded and exited my own company.`;
}

function buildDifferentiator(data: OutreachData): string {
  const { companyName, amountUsd, employeeCount } = data;

  // Project a rough revenue impact based on company stage/size
  const projection = projectRevenue(amountUsd, employeeCount);

  return `You're receiving this message because I built a pipeline — powered entirely by Claude Code — that scrapes AI funding rounds with Exa.ai, enriches recruiter contacts through Apollo, and generates personalized outreach at scale. Using this same method for ${companyName}'s GTM could ${projection}.`;
}

function projectRevenue(amountUsd: number | null, employeeCount: string | null): string {
  // Estimate deal sizes and pipeline based on company stage
  const empCount = employeeCount ? parseInt(employeeCount) : null;

  if (amountUsd && amountUsd >= 500_000_000) {
    // Late stage / large round — enterprise motion
    return "generate $5M–$15M in qualified pipeline per quarter by identifying and reaching the right buyers before your competitors do";
  }
  if (amountUsd && amountUsd >= 100_000_000) {
    // Growth stage
    return "add $2M–$8M in annual pipeline by systematically targeting high-intent accounts at the right moment";
  }
  if (amountUsd && amountUsd >= 30_000_000) {
    // Series A/B
    return "accelerate your first $1M–$3M in pipeline by finding and engaging decision-makers at scale, cutting months off your ramp time";
  }
  // Smaller / unknown
  return "cut your sales cycle in half by targeting the right accounts at the right time with the right message";
}

// ─── Follow-up ─────────────────────────────────────────────────

export function generateFollowup(data: OutreachData): string {
  const { recruiterFirstName, companyName, companySectors } = data;

  const sectorAngle = companySectors.length > 0
    ? `I've been following the ${companySectors[0].toLowerCase()} space closely and ${companyName}'s approach stands out.`
    : `I've been digging into what ${companyName} is building and I'm impressed.`;

  return [
    `Hi ${recruiterFirstName},`,
    "",
    `Quick follow-up on my note last week. ${sectorAngle}`,
    "",
    `The companies that win post-funding are the ones that nail GTM early. I've done it twice — once as a founder and once as first GTM hire at an AI company (deco.cx, $2M ARR).`,
    "",
    `Happy to share specifics on how I built the sales motion at deco.cx. 15 minutes?`,
    "",
    `Leandro`,
  ].join("\n");
}

// ─── LinkedIn Connection Message ───────────────────────────────

export function generateLinkedInNote(data: OutreachData): string {
  const amount = formatAmount(data.amountUsd);
  const roundRef = amount
    ? `${data.companyName}'s ${data.roundType} (${amount})`
    : `${data.companyName}'s ${data.roundType || "recent round"}`;

  // LinkedIn connection notes are limited to 300 chars
  return `Hi ${data.recruiterFirstName} — congrats on ${roundRef}. I was first GTM hire at an AI company (deco.cx, $0→$2M ARR). Sent you an email about your sales openings. Would love to connect.`.slice(0, 300);
}
