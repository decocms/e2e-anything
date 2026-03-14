import { Database } from "bun:sqlite";

// ─── Types ──────────────────────────────────────────────────────

export interface Company {
  id: number;
  name: string;
  normalized_name: string;
  description: string | null;
  website: string | null;
  domain: string | null;
  founded_year: number | null;
  hq_location: string | null;
  hq_country: string | null;
  sectors: string;
  sources: string;
  is_ai_native: number;
  logo_url: string | null;
  employee_count: string | null;
  yc_batch: string | null;
  created_at: string;
  updated_at: string;
}

export interface FundingRound {
  id: number;
  company_id: number;
  round_type: string;
  round_type_normalized: string;
  amount_usd: number | null;
  amount_raw: string | null;
  currency: string;
  announced_date: string;
  investors: string;
  lead_investors: string;
  source_url: string | null;
  source: string;
  created_at: string;
}

export interface ScrapeRun {
  id: number;
  source: string;
  started_at: string;
  completed_at: string | null;
  records_found: number;
  records_new: number;
  records_updated: number;
  status: string;
  error_message: string | null;
}

export interface CompanyInsert {
  name: string;
  normalized_name: string;
  description?: string | null;
  website?: string | null;
  domain?: string | null;
  founded_year?: number | null;
  hq_location?: string | null;
  hq_country?: string | null;
  sectors?: string;
  sources: string;
  is_ai_native?: number;
  logo_url?: string | null;
  employee_count?: string | null;
  yc_batch?: string | null;
}

export interface FundingRoundInsert {
  company_id: number;
  round_type: string;
  round_type_normalized: string;
  amount_usd?: number | null;
  amount_raw?: string | null;
  announced_date: string;
  investors?: string;
  lead_investors?: string;
  source_url?: string | null;
  source: string;
}

// ─── Company Queries ────────────────────────────────────────────

export function insertCompany(db: Database, c: CompanyInsert): number {
  const stmt = db.prepare(`
    INSERT INTO companies (name, normalized_name, description, website, domain,
      founded_year, hq_location, hq_country, sectors, sources, is_ai_native,
      logo_url, employee_count, yc_batch)
    VALUES ($name, $normalized_name, $description, $website, $domain,
      $founded_year, $hq_location, $hq_country, $sectors, $sources, $is_ai_native,
      $logo_url, $employee_count, $yc_batch)
  `);
  const result = stmt.run({
    $name: c.name,
    $normalized_name: c.normalized_name,
    $description: c.description ?? null,
    $website: c.website ?? null,
    $domain: c.domain ?? null,
    $founded_year: c.founded_year ?? null,
    $hq_location: c.hq_location ?? null,
    $hq_country: c.hq_country ?? null,
    $sectors: c.sectors ?? "[]",
    $sources: c.sources,
    $is_ai_native: c.is_ai_native ?? 0,
    $logo_url: c.logo_url ?? null,
    $employee_count: c.employee_count ?? null,
    $yc_batch: c.yc_batch ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function getCompanyById(db: Database, id: number): Company | null {
  return db.prepare("SELECT * FROM companies WHERE id = $id").get({ $id: id }) as Company | null;
}

export function findCompanyByDomain(db: Database, domain: string): Company | null {
  return db.prepare("SELECT * FROM companies WHERE domain = $domain LIMIT 1").get({ $domain: domain }) as Company | null;
}

export function findCompanyByNormalizedName(db: Database, normalizedName: string): Company | null {
  return db.prepare("SELECT * FROM companies WHERE normalized_name = $name LIMIT 1").get({ $name: normalizedName }) as Company | null;
}

export function findCompaniesByNamePrefix(db: Database, prefix: string): Company[] {
  return db.prepare("SELECT * FROM companies WHERE normalized_name LIKE $prefix LIMIT 10").all({ $prefix: prefix + "%" }) as Company[];
}

export function updateCompany(db: Database, id: number, updates: Partial<CompanyInsert>): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { $id: id };

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
      fields.push(`${col} = $${col}`);
      params[`$${col}`] = value;
    }
  }

  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");

  db.prepare(`UPDATE companies SET ${fields.join(", ")} WHERE id = $id`).run(params);
}

export function updateCompanySources(db: Database, id: number, sources: string[]): void {
  db.prepare("UPDATE companies SET sources = $sources, updated_at = datetime('now') WHERE id = $id")
    .run({ $id: id, $sources: JSON.stringify(sources) });
}

// ─── Funding Round Queries ──────────────────────────────────────

export function insertFundingRound(db: Database, r: FundingRoundInsert): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO funding_rounds
      (company_id, round_type, round_type_normalized, amount_usd, amount_raw,
       announced_date, investors, lead_investors, source_url, source)
    VALUES ($company_id, $round_type, $round_type_normalized, $amount_usd, $amount_raw,
       $announced_date, $investors, $lead_investors, $source_url, $source)
  `);
  const result = stmt.run({
    $company_id: r.company_id,
    $round_type: r.round_type,
    $round_type_normalized: r.round_type_normalized,
    $amount_usd: r.amount_usd ?? null,
    $amount_raw: r.amount_raw ?? null,
    $announced_date: r.announced_date,
    $investors: r.investors ?? "[]",
    $lead_investors: r.lead_investors ?? "[]",
    $source_url: r.source_url ?? null,
    $source: r.source,
  });
  return Number(result.lastInsertRowid);
}

export function findExistingRound(
  db: Database,
  companyId: number,
  roundTypeNorm: string,
  date: string
): FundingRound | null {
  return db.prepare(`
    SELECT * FROM funding_rounds
    WHERE company_id = $cid AND round_type_normalized = $rt AND announced_date = $date
    LIMIT 1
  `).get({ $cid: companyId, $rt: roundTypeNorm, $date: date }) as FundingRound | null;
}

export function getFundingsByCompanyId(db: Database, companyId: number): FundingRound[] {
  return db.prepare(
    "SELECT * FROM funding_rounds WHERE company_id = $cid ORDER BY announced_date DESC"
  ).all({ $cid: companyId }) as FundingRound[];
}

// ─── Scrape Run Queries ─────────────────────────────────────────

export function startScrapeRun(db: Database, source: string): number {
  const result = db.prepare(
    "INSERT INTO scrape_runs (source) VALUES ($source)"
  ).run({ $source: source });
  return Number(result.lastInsertRowid);
}

export function completeScrapeRun(
  db: Database,
  id: number,
  recordsFound: number,
  recordsNew: number,
  recordsUpdated: number = 0
): void {
  db.prepare(`
    UPDATE scrape_runs
    SET completed_at = datetime('now'), records_found = $found,
        records_new = $new, records_updated = $updated, status = 'completed'
    WHERE id = $id
  `).run({ $id: id, $found: recordsFound, $new: recordsNew, $updated: recordsUpdated });
}

export function failScrapeRun(db: Database, id: number, error: string): void {
  db.prepare(`
    UPDATE scrape_runs
    SET completed_at = datetime('now'), status = 'failed', error_message = $error
    WHERE id = $id
  `).run({ $id: id, $error: error });
}

export function getRecentScrapeRuns(db: Database, limit: number = 20): ScrapeRun[] {
  return db.prepare(
    "SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT $limit"
  ).all({ $limit: limit }) as ScrapeRun[];
}

// ─── API / Dashboard Queries ────────────────────────────────────

export interface FundingWithCompany extends FundingRound {
  company_name: string;
  company_description: string | null;
  company_website: string | null;
  company_domain: string | null;
  company_hq_location: string | null;
  company_hq_country: string | null;
  company_sectors: string;
  company_is_ai_native: number;
}

export function getRecentFundings(
  db: Database,
  daysBack: number = 90,
  minRound: string = "Series A",
  limit: number = 50,
  offset: number = 0
): FundingWithCompany[] {
  return db.prepare(`
    SELECT
      fr.*,
      c.name AS company_name,
      c.description AS company_description,
      c.website AS company_website,
      c.domain AS company_domain,
      c.hq_location AS company_hq_location,
      c.hq_country AS company_hq_country,
      c.sectors AS company_sectors,
      c.is_ai_native AS company_is_ai_native
    FROM funding_rounds fr
    JOIN companies c ON c.id = fr.company_id
    WHERE fr.announced_date >= date('now', '-' || $days || ' days')
      AND c.is_ai_native = 1
    ORDER BY fr.announced_date DESC
    LIMIT $limit OFFSET $offset
  `).all({ $days: daysBack, $limit: limit, $offset: offset }) as FundingWithCompany[];
}

export function getTotalFundingsCount(db: Database, daysBack: number = 90): number {
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM funding_rounds fr
    JOIN companies c ON c.id = fr.company_id
    WHERE fr.announced_date >= date('now', '-' || $days || ' days')
      AND c.is_ai_native = 1
  `).get({ $days: daysBack }) as { cnt: number };
  return row.cnt;
}

export function searchCompanies(db: Database, query: string, limit: number = 50): Company[] {
  // Clean query for FTS5 - wrap each word in quotes for exact prefix matching
  const cleanQuery = query.trim().split(/\s+/).map(w => `"${w}"*`).join(" ");
  return db.prepare(`
    SELECT c.*
    FROM companies_fts fts
    JOIN companies c ON c.id = fts.rowid
    WHERE companies_fts MATCH $query
    ORDER BY rank
    LIMIT $limit
  `).all({ $query: cleanQuery, $limit: limit }) as Company[];
}

export function listCompanies(
  db: Database,
  opts: { aiOnly?: boolean; limit?: number; offset?: number } = {}
): Company[] {
  const { aiOnly = true, limit = 50, offset = 0 } = opts;
  const where = aiOnly ? "WHERE is_ai_native = 1" : "";
  return db.prepare(`
    SELECT * FROM companies ${where}
    ORDER BY updated_at DESC
    LIMIT $limit OFFSET $offset
  `).all({ $limit: limit, $offset: offset }) as Company[];
}

export function getCompanyWithFundings(db: Database, id: number) {
  const company = getCompanyById(db, id);
  if (!company) return null;
  const fundings = getFundingsByCompanyId(db, id);
  return { ...company, fundings };
}

export interface DashboardStats {
  total_companies: number;
  ai_companies: number;
  total_rounds: number;
  rounds_last_90_days: number;
  total_amount_usd: number;
  sources_count: Record<string, number>;
  last_scrape: string | null;
  rounds_by_type: Record<string, number>;
}

// ─── Job Opening Queries ────────────────────────────────────────

export interface JobOpening {
  id: number;
  company_id: number;
  title: string;
  department: string | null;
  location: string | null;
  employment_type: string | null;
  url: string;
  description_snippet: string | null;
  salary_range: string | null;
  is_sales: number;
  recruiter_name: string | null;
  recruiter_title: string | null;
  recruiter_email: string | null;
  recruiter_linkedin: string | null;
  recruiter_phone: string | null;
  posted_date: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface JobOpeningInsert {
  company_id: number;
  title: string;
  department?: string | null;
  location?: string | null;
  employment_type?: string | null;
  url: string;
  description_snippet?: string | null;
  salary_range?: string | null;
  is_sales?: number;
  recruiter_name?: string | null;
  recruiter_title?: string | null;
  recruiter_email?: string | null;
  recruiter_linkedin?: string | null;
  recruiter_phone?: string | null;
  posted_date?: string | null;
  source: string;
  raw_data?: string | null;
}

export function insertJobOpening(db: Database, j: JobOpeningInsert): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO job_openings
      (company_id, title, department, location, employment_type, url,
       description_snippet, salary_range, is_sales,
       recruiter_name, recruiter_title, recruiter_email, recruiter_linkedin, recruiter_phone,
       posted_date, source, raw_data)
    VALUES ($company_id, $title, $department, $location, $employment_type, $url,
       $description_snippet, $salary_range, $is_sales,
       $recruiter_name, $recruiter_title, $recruiter_email, $recruiter_linkedin, $recruiter_phone,
       $posted_date, $source, $raw_data)
  `);
  const result = stmt.run({
    $company_id: j.company_id,
    $title: j.title,
    $department: j.department ?? null,
    $location: j.location ?? null,
    $employment_type: j.employment_type ?? null,
    $url: j.url,
    $description_snippet: j.description_snippet ?? null,
    $salary_range: j.salary_range ?? null,
    $is_sales: j.is_sales ?? 0,
    $recruiter_name: j.recruiter_name ?? null,
    $recruiter_title: j.recruiter_title ?? null,
    $recruiter_email: j.recruiter_email ?? null,
    $recruiter_linkedin: j.recruiter_linkedin ?? null,
    $recruiter_phone: j.recruiter_phone ?? null,
    $posted_date: j.posted_date ?? null,
    $source: j.source,
    $raw_data: j.raw_data ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function getJobsByCompanyId(db: Database, companyId: number): JobOpening[] {
  return db.prepare(
    "SELECT * FROM job_openings WHERE company_id = $cid ORDER BY is_sales DESC, posted_date DESC"
  ).all({ $cid: companyId }) as JobOpening[];
}

export function getSalesJobsByCompanyId(db: Database, companyId: number): JobOpening[] {
  return db.prepare(
    "SELECT * FROM job_openings WHERE company_id = $cid AND is_sales = 1 ORDER BY posted_date DESC"
  ).all({ $cid: companyId }) as JobOpening[];
}

export interface JobWithCompany extends JobOpening {
  company_name: string;
  company_website: string | null;
  company_domain: string | null;
  company_sectors: string;
  company_hq_location: string | null;
  latest_round: string | null;
  latest_amount: number | null;
}

export interface SalesJobFilters {
  search?: string;
  department?: string;
  source?: string;
  hasRecruiter?: boolean;
  sortBy?: "posted_date" | "company_name" | "department" | "title";
  sortDir?: "asc" | "desc";
}

export function getSalesJobs(
  db: Database,
  limit: number = 50,
  offset: number = 0,
  filters: SalesJobFilters = {}
): JobWithCompany[] {
  const conditions: string[] = ["jo.is_sales = 1", "c.is_ai_native = 1"];
  const params: Record<string, unknown> = { $limit: limit, $offset: offset };

  if (filters.search) {
    conditions.push("(LOWER(c.name) LIKE $search OR LOWER(jo.title) LIKE $search OR LOWER(jo.location) LIKE $search)");
    params.$search = `%${filters.search.toLowerCase()}%`;
  }
  if (filters.department && filters.department !== "all") {
    conditions.push("jo.department = $dept");
    params.$dept = filters.department;
  }
  if (filters.source && filters.source !== "all") {
    conditions.push("jo.source = $source");
    params.$source = filters.source;
  }
  if (filters.hasRecruiter === true) {
    conditions.push("jo.recruiter_name IS NOT NULL");
  } else if (filters.hasRecruiter === false) {
    conditions.push("jo.recruiter_name IS NULL");
  }

  const orderMap: Record<string, string> = {
    posted_date: "jo.posted_date DESC NULLS LAST, jo.created_at DESC",
    company_name: `c.name ${filters.sortDir === "desc" ? "DESC" : "ASC"}, jo.title ASC`,
    department: `jo.department ${filters.sortDir === "desc" ? "DESC" : "ASC"} NULLS LAST, c.name ASC`,
    title: `jo.title ${filters.sortDir === "desc" ? "DESC" : "ASC"}`,
  };
  const orderBy = orderMap[filters.sortBy || "posted_date"] || orderMap.posted_date;

  return db.prepare(`
    SELECT
      jo.*,
      c.name AS company_name,
      c.website AS company_website,
      c.domain AS company_domain,
      c.sectors AS company_sectors,
      c.hq_location AS company_hq_location,
      fr.round_type_normalized AS latest_round,
      fr.amount_usd AS latest_amount
    FROM job_openings jo
    JOIN companies c ON c.id = jo.company_id
    LEFT JOIN (
      SELECT company_id, round_type_normalized, amount_usd,
        ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY announced_date DESC) as rn
      FROM funding_rounds
    ) fr ON fr.company_id = jo.company_id AND fr.rn = 1
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT $limit OFFSET $offset
  `).all(params) as JobWithCompany[];
}

export function getTotalSalesJobsCount(db: Database, filters: SalesJobFilters = {}): number {
  const conditions: string[] = ["jo.is_sales = 1", "c.is_ai_native = 1"];
  const params: Record<string, unknown> = {};

  if (filters.search) {
    conditions.push("(LOWER(c.name) LIKE $search OR LOWER(jo.title) LIKE $search OR LOWER(jo.location) LIKE $search)");
    params.$search = `%${filters.search.toLowerCase()}%`;
  }
  if (filters.department && filters.department !== "all") {
    conditions.push("jo.department = $dept");
    params.$dept = filters.department;
  }
  if (filters.source && filters.source !== "all") {
    conditions.push("jo.source = $source");
    params.$source = filters.source;
  }
  if (filters.hasRecruiter === true) {
    conditions.push("jo.recruiter_name IS NOT NULL");
  } else if (filters.hasRecruiter === false) {
    conditions.push("jo.recruiter_name IS NULL");
  }

  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM job_openings jo
    JOIN companies c ON c.id = jo.company_id
    WHERE ${conditions.join(" AND ")}
  `).get(params) as { cnt: number };
  return row.cnt;
}

export function getCompaniesWithSalesJobs(db: Database): number {
  const row = db.prepare(`
    SELECT COUNT(DISTINCT jo.company_id) as cnt FROM job_openings jo
    JOIN companies c ON c.id = jo.company_id
    WHERE jo.is_sales = 1 AND c.is_ai_native = 1
  `).get() as { cnt: number };
  return row.cnt;
}

export function getJobsWithRecruiters(db: Database, limit: number = 100): JobWithCompany[] {
  return db.prepare(`
    SELECT
      jo.*,
      c.name AS company_name,
      c.website AS company_website,
      c.domain AS company_domain,
      c.sectors AS company_sectors,
      c.hq_location AS company_hq_location,
      fr.round_type_normalized AS latest_round,
      fr.amount_usd AS latest_amount
    FROM job_openings jo
    JOIN companies c ON c.id = jo.company_id
    LEFT JOIN (
      SELECT company_id, round_type_normalized, amount_usd,
        ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY announced_date DESC) as rn
      FROM funding_rounds
    ) fr ON fr.company_id = jo.company_id AND fr.rn = 1
    WHERE jo.is_sales = 1 AND jo.recruiter_name IS NOT NULL AND c.is_ai_native = 1
    ORDER BY jo.posted_date DESC NULLS LAST
    LIMIT $limit
  `).all({ $limit: limit }) as JobWithCompany[];
}

export function getAllAINativeCompanies(db: Database): Company[] {
  return db.prepare(
    "SELECT * FROM companies WHERE is_ai_native = 1 ORDER BY name"
  ).all() as Company[];
}

export function startJobScrapeRun(db: Database): number {
  const result = db.prepare(
    "INSERT INTO job_scrape_runs (status) VALUES ('running')"
  ).run();
  return Number(result.lastInsertRowid);
}

export function completeJobScrapeRun(
  db: Database,
  id: number,
  companiesChecked: number,
  jobsFound: number,
  salesJobsFound: number
): void {
  db.prepare(`
    UPDATE job_scrape_runs
    SET completed_at = datetime('now'), companies_checked = $checked,
        jobs_found = $found, sales_jobs_found = $sales, status = 'completed'
    WHERE id = $id
  `).run({ $id: id, $checked: companiesChecked, $found: jobsFound, $sales: salesJobsFound });
}

export function getJobStats(db: Database): {
  total_jobs: number;
  sales_jobs: number;
  companies_with_sales_jobs: number;
  jobs_with_recruiters: number;
} {
  const totalJobs = (db.prepare("SELECT COUNT(*) as cnt FROM job_openings").get() as { cnt: number }).cnt;
  const salesJobs = (db.prepare("SELECT COUNT(*) as cnt FROM job_openings WHERE is_sales = 1").get() as { cnt: number }).cnt;
  const companiesWithSales = (db.prepare(
    "SELECT COUNT(DISTINCT company_id) as cnt FROM job_openings WHERE is_sales = 1"
  ).get() as { cnt: number }).cnt;
  const jobsWithRecruiters = (db.prepare(
    "SELECT COUNT(*) as cnt FROM job_openings WHERE is_sales = 1 AND recruiter_name IS NOT NULL"
  ).get() as { cnt: number }).cnt;

  return {
    total_jobs: totalJobs,
    sales_jobs: salesJobs,
    companies_with_sales_jobs: companiesWithSales,
    jobs_with_recruiters: jobsWithRecruiters,
  };
}

// ─── Company Recruiter Queries ──────────────────────────────────

export interface CompanyRecruiter {
  id: number;
  company_id: number;
  name: string;
  title: string | null;
  email: string | null;
  email_guessed: number;
  email_verified: number;
  email_source: string;
  linkedin_url: string | null;
  phone: string | null;
  source: string;
  confidence: string;
  created_at: string;
  updated_at: string;
}

export interface CompanyRecruiterInsert {
  company_id: number;
  name: string;
  title?: string | null;
  email?: string | null;
  email_guessed?: number;
  email_verified?: number;
  email_source?: string;
  linkedin_url?: string | null;
  phone?: string | null;
  source: string;
  confidence?: string;
}

export function insertCompanyRecruiter(db: Database, r: CompanyRecruiterInsert): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO company_recruiters
      (company_id, name, title, email, email_guessed, email_verified, email_source, linkedin_url, phone, source, confidence)
    VALUES ($company_id, $name, $title, $email, $email_guessed, $email_verified, $email_source, $linkedin_url, $phone, $source, $confidence)
  `);
  const result = stmt.run({
    $company_id: r.company_id,
    $name: r.name,
    $title: r.title ?? null,
    $email: r.email ?? null,
    $email_guessed: r.email_guessed ?? 0,
    $email_verified: r.email_verified ?? 0,
    $email_source: r.email_source ?? "guess",
    $linkedin_url: r.linkedin_url ?? null,
    $phone: r.phone ?? null,
    $source: r.source,
    $confidence: r.confidence ?? "medium",
  });
  return Number(result.lastInsertRowid);
}

export function updateCompanyRecruiter(db: Database, id: number, updates: Partial<CompanyRecruiterInsert>): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { $id: id };

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = $${key}`);
      params[`$${key}`] = value;
    }
  }

  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");

  db.prepare(`UPDATE company_recruiters SET ${fields.join(", ")} WHERE id = $id`).run(params);
}

export function getRecruitersByCompanyId(db: Database, companyId: number): CompanyRecruiter[] {
  return db.prepare(
    "SELECT * FROM company_recruiters WHERE company_id = $cid ORDER BY confidence DESC, name"
  ).all({ $cid: companyId }) as CompanyRecruiter[];
}

export interface RecruiterWithCompany extends CompanyRecruiter {
  company_name: string;
  company_domain: string | null;
  company_website: string | null;
  sales_job_count: number;
}

export function getRecruitersWithCompanies(db: Database, limit: number = 200): RecruiterWithCompany[] {
  return db.prepare(`
    SELECT
      cr.*,
      c.name AS company_name,
      c.domain AS company_domain,
      c.website AS company_website,
      (SELECT COUNT(*) FROM job_openings jo WHERE jo.company_id = cr.company_id AND jo.is_sales = 1) AS sales_job_count
    FROM company_recruiters cr
    JOIN companies c ON c.id = cr.company_id
    ORDER BY cr.confidence DESC, c.name, cr.name
    LIMIT $limit
  `).all({ $limit: limit }) as RecruiterWithCompany[];
}

export function getCompaniesWithSalesJobsNeedingRecruiters(db: Database): Company[] {
  return db.prepare(`
    SELECT DISTINCT c.* FROM companies c
    JOIN job_openings jo ON jo.company_id = c.id
    WHERE jo.is_sales = 1
    AND c.id NOT IN (SELECT company_id FROM company_recruiters)
    ORDER BY c.name
  `).all() as Company[];
}

export function getRecruiterStats(db: Database): {
  total_recruiters: number;
  companies_with_recruiters: number;
  recruiters_with_email: number;
  recruiters_with_verified_email: number;
  recruiters_with_guessed_email: number;
  recruiters_with_linkedin: number;
} {
  const total = (db.prepare("SELECT COUNT(*) as cnt FROM company_recruiters").get() as { cnt: number }).cnt;
  const companies = (db.prepare("SELECT COUNT(DISTINCT company_id) as cnt FROM company_recruiters").get() as { cnt: number }).cnt;
  const withEmail = (db.prepare("SELECT COUNT(*) as cnt FROM company_recruiters WHERE email IS NOT NULL").get() as { cnt: number }).cnt;
  const withVerified = (db.prepare("SELECT COUNT(*) as cnt FROM company_recruiters WHERE email_verified = 1").get() as { cnt: number }).cnt;
  const withGuessed = (db.prepare("SELECT COUNT(*) as cnt FROM company_recruiters WHERE email_guessed = 1 AND email_verified = 0").get() as { cnt: number }).cnt;
  const withLinkedin = (db.prepare("SELECT COUNT(*) as cnt FROM company_recruiters WHERE linkedin_url IS NOT NULL").get() as { cnt: number }).cnt;

  return {
    total_recruiters: total,
    companies_with_recruiters: companies,
    recruiters_with_email: withEmail,
    recruiters_with_verified_email: withVerified,
    recruiters_with_guessed_email: withGuessed,
    recruiters_with_linkedin: withLinkedin,
  };
}

export function getStats(db: Database): DashboardStats {
  const totalCompanies = (db.prepare("SELECT COUNT(*) as cnt FROM companies").get() as { cnt: number }).cnt;
  const aiCompanies = (db.prepare("SELECT COUNT(*) as cnt FROM companies WHERE is_ai_native = 1").get() as { cnt: number }).cnt;
  const totalRounds = (db.prepare("SELECT COUNT(*) as cnt FROM funding_rounds").get() as { cnt: number }).cnt;
  const roundsRecent = (db.prepare(
    "SELECT COUNT(*) as cnt FROM funding_rounds WHERE announced_date >= date('now', '-90 days')"
  ).get() as { cnt: number }).cnt;
  const totalAmount = (db.prepare(
    "SELECT COALESCE(SUM(amount_usd), 0) as total FROM funding_rounds WHERE amount_usd IS NOT NULL"
  ).get() as { total: number }).total;

  const lastScrape = db.prepare(
    "SELECT completed_at FROM scrape_runs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1"
  ).get() as { completed_at: string } | null;

  // Rounds by type
  const typeRows = db.prepare(
    "SELECT round_type_normalized, COUNT(*) as cnt FROM funding_rounds GROUP BY round_type_normalized ORDER BY cnt DESC"
  ).all() as { round_type_normalized: string; cnt: number }[];
  const roundsByType: Record<string, number> = {};
  for (const row of typeRows) roundsByType[row.round_type_normalized] = row.cnt;

  // Source counts
  const sourceRows = db.prepare(
    "SELECT source, COUNT(*) as cnt FROM funding_rounds GROUP BY source ORDER BY cnt DESC"
  ).all() as { source: string; cnt: number }[];
  const sourcesCount: Record<string, number> = {};
  for (const row of sourceRows) sourcesCount[row.source] = row.cnt;

  return {
    total_companies: totalCompanies,
    ai_companies: aiCompanies,
    total_rounds: totalRounds,
    rounds_last_90_days: roundsRecent,
    total_amount_usd: totalAmount,
    sources_count: sourcesCount,
    last_scrape: lastScrape?.completed_at ?? null,
    rounds_by_type: roundsByType,
  };
}
