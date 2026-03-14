/**
 * Outreach Email Generator
 *
 * Queries the database for recruiters with verified emails at recently
 * funded AI companies, generates personalized outreach emails, and
 * exports as CSV ready for sending.
 */

import { getDb, closeDb } from "../db";
import {
  generateSubject,
  generateBody,
  generateFollowup,
  generateLinkedInNote,
  type OutreachData,
} from "./templates";
import { resolve, dirname } from "path";

const PROJECT_ROOT = resolve(dirname(import.meta.dir), "..");

interface OutreachRow {
  // Recruiter
  recruiter_name: string;
  recruiter_email: string;
  email_verified: number;
  recruiter_linkedin: string | null;
  recruiter_title: string | null;
  // Company
  company_name: string;
  company_domain: string | null;
  company_description: string | null;
  company_sectors: string;
  company_location: string | null;
  employee_count: string | null;
  // Funding (latest)
  round_type: string | null;
  amount_usd: number | null;
  announced_date: string | null;
  lead_investors: string | null;
  // Jobs
  job_titles: string | null;
  sales_job_count: number;
}

function queryOutreachData(db: ReturnType<typeof getDb>, verifiedOnly: boolean): OutreachRow[] {
  const verifiedFilter = verifiedOnly ? "AND cr.email_verified = 1" : "";

  return db.prepare(`
    SELECT
      cr.name as recruiter_name,
      cr.email as recruiter_email,
      cr.email_verified,
      cr.linkedin_url as recruiter_linkedin,
      cr.title as recruiter_title,
      c.name as company_name,
      c.domain as company_domain,
      c.description as company_description,
      c.sectors as company_sectors,
      c.hq_location as company_location,
      c.employee_count,
      latest_fr.round_type,
      latest_fr.amount_usd,
      latest_fr.announced_date,
      latest_fr.lead_investors,
      GROUP_CONCAT(DISTINCT jo.title) as job_titles,
      COUNT(DISTINCT jo.id) as sales_job_count
    FROM company_recruiters cr
    JOIN companies c ON c.id = cr.company_id
    LEFT JOIN (
      SELECT fr1.*
      FROM funding_rounds fr1
      INNER JOIN (
        SELECT company_id, MAX(announced_date) as max_date
        FROM funding_rounds
        GROUP BY company_id
      ) fr2 ON fr1.company_id = fr2.company_id AND fr1.announced_date = fr2.max_date
    ) latest_fr ON latest_fr.company_id = c.id
    LEFT JOIN job_openings jo ON jo.company_id = c.id AND jo.is_sales = 1
    WHERE cr.email IS NOT NULL
      AND c.is_ai_native = 1
      AND c.domain IS NOT NULL
      AND LOWER(SUBSTR(cr.email, INSTR(cr.email, '@') + 1)) = LOWER(c.domain)
      ${verifiedFilter}
    GROUP BY cr.id
    ORDER BY cr.email_verified DESC, latest_fr.announced_date DESC
  `).all() as OutreachRow[];
}

function rowToOutreachData(row: OutreachRow): OutreachData {
  const nameParts = row.recruiter_name.split(/\s+/);
  let sectors: string[] = [];
  try {
    sectors = JSON.parse(row.company_sectors || "[]");
  } catch {}

  let leadInvestors: string[] = [];
  try {
    leadInvestors = JSON.parse(row.lead_investors || "[]");
  } catch {}

  const salesRoles = row.job_titles
    ? [...new Set(row.job_titles.split(",").map((t) => t.trim()))]
    : [];

  return {
    recruiterName: row.recruiter_name,
    recruiterFirstName: nameParts[0],
    recruiterEmail: row.recruiter_email,
    emailVerified: row.email_verified === 1,
    linkedinUrl: row.recruiter_linkedin,
    companyName: row.company_name,
    companyDomain: row.company_domain,
    companyDescription: row.company_description,
    companySectors: sectors,
    companyLocation: row.company_location,
    employeeCount: row.employee_count,
    roundType: row.round_type,
    amountUsd: row.amount_usd,
    announcedDate: row.announced_date,
    leadInvestors,
    salesRoles,
    salesJobCount: row.sales_job_count,
  };
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function generateOutreachCsv(verifiedOnly = false): {
  csv: string;
  count: number;
  verifiedCount: number;
} {
  const db = getDb();
  const rows = queryOutreachData(db, verifiedOnly);

  const headers = [
    "company",
    "recruiter_name",
    "recruiter_email",
    "email_verified",
    "linkedin_url",
    "round_type",
    "amount_usd",
    "announced_date",
    "lead_investors",
    "sales_roles",
    "subject_line",
    "email_body",
    "followup_body",
    "linkedin_note",
  ];

  const csvRows = [headers.join(",")];
  let verifiedCount = 0;

  for (const row of rows) {
    const data = rowToOutreachData(row);
    if (data.emailVerified) verifiedCount++;

    const subject = generateSubject(data);
    const body = generateBody(data);
    const followup = generateFollowup(data);
    const linkedinNote = generateLinkedInNote(data);

    csvRows.push(
      [
        escapeCsv(data.companyName),
        escapeCsv(data.recruiterName),
        escapeCsv(data.recruiterEmail),
        data.emailVerified ? "yes" : "no",
        escapeCsv(data.linkedinUrl || ""),
        escapeCsv(data.roundType || ""),
        data.amountUsd ? String(data.amountUsd) : "",
        escapeCsv(data.announcedDate || ""),
        escapeCsv(data.leadInvestors.join(", ")),
        escapeCsv(data.salesRoles.join(", ")),
        escapeCsv(subject),
        escapeCsv(body),
        escapeCsv(followup),
        escapeCsv(linkedinNote),
      ].join(",")
    );
  }

  return {
    csv: csvRows.join("\n"),
    count: rows.length,
    verifiedCount,
  };
}

// ─── CLI Entry Point ────────────────────────────────────────────

if (import.meta.main) {
  const verifiedOnly = process.argv.includes("--verified-only");
  const today = new Date().toISOString().split("T")[0];
  const suffix = verifiedOnly ? "-verified" : "";
  const outPath = resolve(PROJECT_ROOT, "data", `outreach${suffix}-${today}.csv`);

  console.log("\n===================================================");
  console.log("  Outreach Email Generator");
  console.log(`  Mode: ${verifiedOnly ? "Verified emails only" : "All emails"}`);
  console.log("===================================================\n");

  try {
    const { csv, count, verifiedCount } = generateOutreachCsv(verifiedOnly);

    await Bun.write(outPath, csv);

    console.log(`  Generated ${count} outreach emails`);
    console.log(`    Verified: ${verifiedCount}`);
    console.log(`    Guessed: ${count - verifiedCount}`);
    console.log(`\n  Saved to: ${outPath}`);
    console.log("\n===================================================\n");
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  } finally {
    closeDb();
  }
}
