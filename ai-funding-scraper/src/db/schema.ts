export const SCHEMA_SQL = `
  -- Core companies table
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    description TEXT,
    website TEXT,
    domain TEXT,
    founded_year INTEGER,
    hq_location TEXT,
    hq_country TEXT,
    sectors TEXT NOT NULL DEFAULT '[]',
    sources TEXT NOT NULL DEFAULT '[]',
    is_ai_native INTEGER DEFAULT 0,
    logo_url TEXT,
    employee_count TEXT,
    yc_batch TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Funding rounds table
  CREATE TABLE IF NOT EXISTS funding_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    round_type TEXT NOT NULL,
    round_type_normalized TEXT NOT NULL,
    amount_usd REAL,
    amount_raw TEXT,
    currency TEXT DEFAULT 'USD',
    announced_date TEXT NOT NULL,
    investors TEXT NOT NULL DEFAULT '[]',
    lead_investors TEXT NOT NULL DEFAULT '[]',
    source_url TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, round_type_normalized, announced_date)
  );

  -- Scrape run tracking
  CREATE TABLE IF NOT EXISTS scrape_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    records_found INTEGER DEFAULT 0,
    records_new INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    error_message TEXT
  );

  -- FTS5 for full-text search on companies
  CREATE VIRTUAL TABLE IF NOT EXISTS companies_fts USING fts5(
    name,
    description,
    sectors,
    hq_location,
    content=companies,
    content_rowid=id
  );

  -- Triggers to keep FTS in sync
  CREATE TRIGGER IF NOT EXISTS companies_fts_insert AFTER INSERT ON companies BEGIN
    INSERT INTO companies_fts(rowid, name, description, sectors, hq_location)
    VALUES (new.id, new.name, new.description, new.sectors, new.hq_location);
  END;

  CREATE TRIGGER IF NOT EXISTS companies_fts_delete AFTER DELETE ON companies BEGIN
    INSERT INTO companies_fts(companies_fts, rowid, name, description, sectors, hq_location)
    VALUES ('delete', old.id, old.name, old.description, old.sectors, old.hq_location);
  END;

  CREATE TRIGGER IF NOT EXISTS companies_fts_update AFTER UPDATE ON companies BEGIN
    INSERT INTO companies_fts(companies_fts, rowid, name, description, sectors, hq_location)
    VALUES ('delete', old.id, old.name, old.description, old.sectors, old.hq_location);
    INSERT INTO companies_fts(rowid, name, description, sectors, hq_location)
    VALUES (new.id, new.name, new.description, new.sectors, new.hq_location);
  END;

  -- Job openings for each company
  CREATE TABLE IF NOT EXISTS job_openings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    department TEXT,
    location TEXT,
    employment_type TEXT,
    url TEXT NOT NULL,
    description_snippet TEXT,
    salary_range TEXT,
    is_sales INTEGER DEFAULT 0,
    recruiter_name TEXT,
    recruiter_title TEXT,
    recruiter_email TEXT,
    recruiter_linkedin TEXT,
    recruiter_phone TEXT,
    posted_date TEXT,
    source TEXT NOT NULL DEFAULT 'unknown',
    raw_data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, url)
  );

  -- Job scrape run tracking
  CREATE TABLE IF NOT EXISTS job_scrape_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    companies_checked INTEGER DEFAULT 0,
    jobs_found INTEGER DEFAULT 0,
    sales_jobs_found INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    error_message TEXT
  );

  -- Company recruiters / talent team
  CREATE TABLE IF NOT EXISTS company_recruiters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    title TEXT,
    email TEXT,
    email_guessed INTEGER DEFAULT 0,
    email_verified INTEGER DEFAULT 0,
    email_source TEXT DEFAULT 'guess',
    linkedin_url TEXT,
    phone TEXT,
    source TEXT NOT NULL DEFAULT 'unknown',
    confidence TEXT NOT NULL DEFAULT 'medium',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, name)
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_companies_normalized_name ON companies(normalized_name);
  CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);
  CREATE INDEX IF NOT EXISTS idx_companies_ai ON companies(is_ai_native);
  CREATE INDEX IF NOT EXISTS idx_funding_date ON funding_rounds(announced_date);
  CREATE INDEX IF NOT EXISTS idx_funding_type ON funding_rounds(round_type_normalized);
  CREATE INDEX IF NOT EXISTS idx_funding_company ON funding_rounds(company_id);
  CREATE INDEX IF NOT EXISTS idx_scrape_runs_source ON scrape_runs(source);
  CREATE INDEX IF NOT EXISTS idx_job_openings_company ON job_openings(company_id);
  CREATE INDEX IF NOT EXISTS idx_job_openings_sales ON job_openings(is_sales);
  CREATE INDEX IF NOT EXISTS idx_job_openings_recruiter ON job_openings(recruiter_name);
  CREATE INDEX IF NOT EXISTS idx_company_recruiters_company ON company_recruiters(company_id);
`;
