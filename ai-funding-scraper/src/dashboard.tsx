import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./dashboard.css";

// ─── Types ──────────────────────────────────────────────────────

interface Stats {
  total_companies: number;
  ai_companies: number;
  total_rounds: number;
  rounds_last_90_days: number;
  total_amount_usd: number;
  sources_count: Record<string, number>;
  last_scrape: string | null;
  rounds_by_type: Record<string, number>;
}

interface JobStats {
  total_jobs: number;
  sales_jobs: number;
  companies_with_sales_jobs: number;
  jobs_with_recruiters: number;
}

interface RecruiterStats {
  total_recruiters: number;
  companies_with_recruiters: number;
  recruiters_with_email: number;
  recruiters_with_verified_email: number;
  recruiters_with_guessed_email: number;
  recruiters_with_linkedin: number;
}

interface FundingRow {
  id: number;
  company_id: number;
  company_name: string;
  company_description: string | null;
  company_website: string | null;
  company_domain: string | null;
  company_hq_location: string | null;
  company_hq_country: string | null;
  company_sectors: string[];
  company_is_ai_native: number;
  round_type: string;
  round_type_normalized: string;
  amount_usd: number | null;
  amount_raw: string | null;
  announced_date: string;
  investors: string[];
  lead_investors: string[];
  source: string;
  source_url: string | null;
}

interface SalesJobRow {
  id: number;
  company_id: number;
  company_name: string;
  company_website: string | null;
  company_domain: string | null;
  company_sectors: string[];
  company_hq_location: string | null;
  latest_round: string | null;
  latest_amount: number | null;
  title: string;
  department: string | null;
  location: string | null;
  url: string;
  description_snippet: string | null;
  recruiter_name: string | null;
  recruiter_title: string | null;
  recruiter_email: string | null;
  recruiter_linkedin: string | null;
  posted_date: string | null;
  source: string;
}

interface RecruiterRow {
  id: number;
  company_id: number;
  company_name: string;
  company_domain: string | null;
  company_website: string | null;
  sales_job_count: number;
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
}

// ─── Formatters ─────────────────────────────────────────────────

function formatAmount(usd: number | null): string {
  if (!usd) return "Undisclosed";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function roundBadgeClass(round: string): string {
  const lower = round.toLowerCase().replace(/\s+/g, "-");
  if (lower.includes("series-a")) return "series-a";
  if (lower.includes("series-b")) return "series-b";
  if (lower.includes("series-c")) return "series-c";
  if (lower.includes("series-d")) return "series-d";
  if (lower.includes("series-e") || lower.includes("series-f")) return "series-e";
  if (lower.includes("growth") || lower.includes("late")) return "growth";
  return "other";
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Tabs ───────────────────────────────────────────────────────

type TabId = "funding" | "sales-jobs" | "recruiters";

// ─── App ────────────────────────────────────────────────────────

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("funding");
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [recruiterStats, setRecruiterStats] = useState<RecruiterStats | null>(null);
  const [fundings, setFundings] = useState<FundingRow[]>([]);
  const [salesJobs, setSalesJobs] = useState<SalesJobRow[]>([]);
  const [recruiters, setRecruiters] = useState<RecruiterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [scrapingJobs, setScrapingJobs] = useState(false);
  const [findingRecruiters, setFindingRecruiters] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [roundFilter, setRoundFilter] = useState("all");
  const [daysBack, setDaysBack] = useState(90);
  const [toast, setToast] = useState<string | null>(null);
  const [jobPage, setJobPage] = useState(1);
  const [jobTotalPages, setJobTotalPages] = useState(1);
  const [jobTotal, setJobTotal] = useState(0);

  // Sales Jobs filters
  const [jobSearch, setJobSearch] = useState("");
  const [jobDepartment, setJobDepartment] = useState("all");
  const [jobSource, setJobSource] = useState("all");
  const [jobHasRecruiter, setJobHasRecruiter] = useState("all");
  const [jobSortBy, setJobSortBy] = useState<"posted_date" | "company_name" | "department" | "title">("posted_date");
  const [jobSortDir, setJobSortDir] = useState<"asc" | "desc">("desc");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, jobStatsRes, recStatsRes] = await Promise.all([
        fetch("/api/stats"),
        fetch("/api/jobs/stats"),
        fetch("/api/recruiters/stats"),
      ]);
      setStats(await statsRes.json());
      setJobStats(await jobStatsRes.json());
      setRecruiterStats(await recStatsRes.json());
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, []);

  const fetchFundings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "50",
        days: String(daysBack),
      });

      const res = await fetch(`/api/fundings?${params}`);
      const data = await res.json();

      let filtered = data.data || [];
      if (roundFilter !== "all") {
        filtered = filtered.filter(
          (f: FundingRow) => f.round_type_normalized === roundFilter
        );
      }

      setFundings(filtered);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Failed to fetch fundings:", err);
    } finally {
      setLoading(false);
    }
  }, [page, daysBack, roundFilter]);

  const fetchSalesJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(jobPage),
        limit: "50",
        sort: jobSortBy,
        dir: jobSortDir,
      });
      if (jobSearch.trim()) params.set("q", jobSearch.trim());
      if (jobDepartment !== "all") params.set("department", jobDepartment);
      if (jobSource !== "all") params.set("source", jobSource);
      if (jobHasRecruiter !== "all") params.set("has_recruiter", jobHasRecruiter);

      const res = await fetch(`/api/jobs/sales?${params}`);
      const data = await res.json();

      setSalesJobs(data.data || []);
      setJobTotalPages(data.totalPages || 1);
      setJobTotal(data.total || 0);
    } catch (err) {
      console.error("Failed to fetch sales jobs:", err);
    } finally {
      setLoading(false);
    }
  }, [jobPage, jobSearch, jobDepartment, jobSource, jobHasRecruiter, jobSortBy, jobSortDir]);

  const fetchRecruiters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recruiters?limit=500");
      const data = await res.json();
      setRecruiters(data.data || []);
      if (data.stats) setRecruiterStats(data.stats);
    } catch (err) {
      console.error("Failed to fetch recruiters:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    if (activeTab === "funding") fetchFundings();
    else if (activeTab === "sales-jobs") fetchSalesJobs();
    else if (activeTab === "recruiters") fetchRecruiters();
  }, [activeTab, fetchFundings, fetchSalesJobs, fetchRecruiters]);

  const handleScrape = async () => {
    setScraping(true);
    showToast("Funding scrape started...");
    try {
      await fetch("/api/scrape", { method: "POST" });
      const poll = setInterval(async () => {
        const res = await fetch("/api/scrape-runs");
        const runs = await res.json();
        const latest = runs[0];
        if (latest && latest.status !== "running") {
          clearInterval(poll);
          setScraping(false);
          showToast(`Scrape complete! ${latest.records_new || 0} new records`);
          fetchStats();
          fetchFundings();
        }
      }, 5000);
    } catch {
      setScraping(false);
      showToast("Scrape failed");
    }
  };

  const handleJobScrape = async () => {
    setScrapingJobs(true);
    showToast("Job scrape started... this may take a few minutes.");
    try {
      await fetch("/api/jobs/scrape", { method: "POST" });
      const poll = setInterval(async () => {
        const res = await fetch("/api/jobs/stats");
        const data = await res.json();
        if (data.total_jobs > (jobStats?.total_jobs || 0)) {
          clearInterval(poll);
          setScrapingJobs(false);
          showToast(`Job scrape complete! ${data.sales_jobs} sales jobs found.`);
          fetchStats();
          fetchSalesJobs();
        }
      }, 8000);
      setTimeout(() => {
        setScrapingJobs(false);
        fetchStats();
        fetchSalesJobs();
      }, 600000);
    } catch {
      setScrapingJobs(false);
      showToast("Job scrape failed");
    }
  };

  const handleFindRecruiters = async () => {
    setFindingRecruiters(true);
    showToast("Finding recruiters... this may take a few minutes.");
    try {
      await fetch("/api/recruiters/find", { method: "POST" });
      const poll = setInterval(async () => {
        try {
          const res = await fetch("/api/recruiters/stats");
          const data = await res.json();
          if (data.total_recruiters > (recruiterStats?.total_recruiters || 0)) {
            clearInterval(poll);
            setFindingRecruiters(false);
            showToast(`Found ${data.total_recruiters} recruiters across ${data.companies_with_recruiters} companies!`);
            fetchStats();
            fetchRecruiters();
          }
        } catch {}
      }, 10000);
      setTimeout(() => {
        setFindingRecruiters(false);
        fetchStats();
        fetchRecruiters();
      }, 600000);
    } catch {
      setFindingRecruiters(false);
      showToast("Recruiter finder failed");
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === "funding") fetchFundings();
  };

  const handleJobSort = (col: "posted_date" | "company_name" | "department" | "title") => {
    if (jobSortBy === col) {
      setJobSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setJobSortBy(col);
      setJobSortDir(col === "posted_date" ? "desc" : "asc");
    }
    setJobPage(1);
  };

  const sortIcon = (col: string) => {
    if (jobSortBy !== col) return <span className="sort-icon inactive">{"\u2195"}</span>;
    return <span className="sort-icon active">{jobSortDir === "asc" ? "\u2191" : "\u2193"}</span>;
  };

  // Group recruiters by company for the recruiters tab
  const recruitersByCompany = React.useMemo(() => {
    const map = new Map<number, { company: { id: number; name: string; domain: string | null; website: string | null; salesJobCount: number }; recruiters: RecruiterRow[] }>();
    for (const r of recruiters) {
      if (!map.has(r.company_id)) {
        map.set(r.company_id, {
          company: {
            id: r.company_id,
            name: r.company_name,
            domain: r.company_domain,
            website: r.company_website,
            salesJobCount: r.sales_job_count,
          },
          recruiters: [],
        });
      }
      map.get(r.company_id)!.recruiters.push(r);
    }
    return [...map.values()].sort((a, b) => b.company.salesJobCount - a.company.salesJobCount);
  }, [recruiters]);

  return (
    <div className="app">
      {/* Header */}
      <header>
        <h1><span>AI</span> Funding Tracker</h1>
        <div className="header-actions">
          {activeTab === "funding" && (
            <>
              <a href="/api/export/csv" className="btn btn-secondary" download>Export CSV</a>
              <button className="btn btn-primary" onClick={handleScrape} disabled={scraping}>
                {scraping ? <><span className="spinner" /> Scraping...</> : "Run Scrape"}
              </button>
            </>
          )}
          {activeTab === "sales-jobs" && (
            <>
              <a href="/api/export/sales-jobs-csv" className="btn btn-secondary" download>Export CSV</a>
              <button className="btn btn-primary" onClick={handleJobScrape} disabled={scrapingJobs}>
                {scrapingJobs ? <><span className="spinner" /> Finding Jobs...</> : "Find Sales Jobs"}
              </button>
            </>
          )}
          {activeTab === "recruiters" && (
            <>
              <a href="/api/export/sales-jobs-csv" className="btn btn-secondary" download>Export CSV</a>
              <button className="btn btn-primary" onClick={handleFindRecruiters} disabled={findingRecruiters}>
                {findingRecruiters ? <><span className="spinner" /> Finding...</> : "Find Recruiters"}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === "funding" ? "active" : ""}`}
          onClick={() => { setActiveTab("funding"); setPage(1); }}
        >
          Funding Rounds
        </button>
        <button
          className={`tab ${activeTab === "sales-jobs" ? "active" : ""}`}
          onClick={() => { setActiveTab("sales-jobs"); setJobPage(1); }}
        >
          Sales Jobs
          {jobStats && jobStats.sales_jobs > 0 && (
            <span className="tab-count">{jobStats.sales_jobs}</span>
          )}
        </button>
        <button
          className={`tab ${activeTab === "recruiters" ? "active" : ""}`}
          onClick={() => setActiveTab("recruiters")}
        >
          Recruiters
          {recruiterStats && recruiterStats.total_recruiters > 0 && (
            <span className="tab-count">{recruiterStats.total_recruiters}</span>
          )}
        </button>
      </div>

      {/* Stats: Funding */}
      {activeTab === "funding" && stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="label">AI Companies</div>
            <div className="value accent">{(stats.ai_companies ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="label">Funding Rounds (90d)</div>
            <div className="value blue">{(stats.rounds_last_90_days ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="label">Total Funding Tracked</div>
            <div className="value green">{formatAmount(stats.total_amount_usd ?? 0)}</div>
          </div>
          <div className="stat-card">
            <div className="label">Last Scrape</div>
            <div className="value">{timeAgo(stats.last_scrape)}</div>
          </div>
        </div>
      )}

      {/* Stats: Sales Jobs */}
      {activeTab === "sales-jobs" && jobStats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="label">Sales Job Openings</div>
            <div className="value accent">{(jobStats.sales_jobs ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="label">Companies Hiring Sales</div>
            <div className="value blue">{(jobStats.companies_with_sales_jobs ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="label">With Recruiter Info</div>
            <div className="value green">{(jobStats.jobs_with_recruiters ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="label">Total Job Listings</div>
            <div className="value">{(jobStats.total_jobs ?? 0).toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Stats: Recruiters */}
      {activeTab === "recruiters" && recruiterStats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="label">Recruiters Found</div>
            <div className="value accent">{(recruiterStats.total_recruiters ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="label">Companies Covered</div>
            <div className="value blue">{(recruiterStats.companies_with_recruiters ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="label">Verified Emails</div>
            <div className="value green">{(recruiterStats.recruiters_with_verified_email ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="label">Guessed Emails</div>
            <div className="value" style={{ color: "#f59e0b" }}>{(recruiterStats.recruiters_with_guessed_email ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="label">With LinkedIn</div>
            <div className="value blue">{(recruiterStats.recruiters_with_linkedin ?? 0).toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Funding Tab Controls */}
      {activeTab === "funding" && (
        <div className="controls">
          <form onSubmit={handleSearch} style={{ flex: 1, display: "flex", gap: 8 }}>
            <input
              type="text"
              className="search-input"
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <select
            value={roundFilter}
            onChange={(e) => { setRoundFilter(e.target.value); setPage(1); }}
          >
            <option value="all">All Rounds</option>
            <option value="Series A">Series A</option>
            <option value="Series B">Series B</option>
            <option value="Series C">Series C</option>
            <option value="Series D">Series D+</option>
            <option value="Growth">Growth</option>
            <option value="Late Stage">Late Stage</option>
          </select>
          <select
            value={daysBack}
            onChange={(e) => { setDaysBack(parseInt(e.target.value)); setPage(1); }}
          >
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last year</option>
          </select>
        </div>
      )}

      {/* Sales Jobs Tab Controls */}
      {activeTab === "sales-jobs" && (
        <div className="controls">
          <input
            type="text"
            className="search-input"
            placeholder="Search companies, job titles..."
            value={jobSearch}
            onChange={(e) => { setJobSearch(e.target.value); setJobPage(1); }}
          />
          <div className="filter-selects">
            <select
              value={jobDepartment}
              onChange={(e) => { setJobDepartment(e.target.value); setJobPage(1); }}
            >
              <option value="all">All Departments</option>
              <option value="Account Executive">Account Executive</option>
              <option value="Sales Development">Sales Development</option>
              <option value="Account Management">Account Management</option>
              <option value="Sales">Sales</option>
              <option value="Revenue/GTM">Revenue/GTM</option>
              <option value="Sales Engineering">Sales Engineering</option>
              <option value="Partnerships">Partnerships</option>
              <option value="Sales Leadership">Sales Leadership</option>
            </select>
            <select
              value={jobSource}
              onChange={(e) => { setJobSource(e.target.value); setJobPage(1); }}
            >
              <option value="all">All Sources</option>
              <option value="ashby">Ashby</option>
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="workable">Workable</option>
              <option value="exa-jobs">Exa</option>
              <option value="career-page">Career Page</option>
            </select>
            <select
              value={jobHasRecruiter}
              onChange={(e) => { setJobHasRecruiter(e.target.value); setJobPage(1); }}
            >
              <option value="all">All Jobs</option>
              <option value="true">With Recruiter</option>
              <option value="false">Without Recruiter</option>
            </select>
          </div>
        </div>
      )}

      {/* Active Filters Bar */}
      {activeTab === "sales-jobs" && (jobSearch || jobDepartment !== "all" || jobSource !== "all" || jobHasRecruiter !== "all") && (
        <div className="filter-active-bar">
          <span>Filters:</span>
          {jobSearch && (
            <span className="filter-tag">
              Search: {jobSearch}
              <button onClick={() => { setJobSearch(""); setJobPage(1); }}>&times;</button>
            </span>
          )}
          {jobDepartment !== "all" && (
            <span className="filter-tag">
              {jobDepartment}
              <button onClick={() => { setJobDepartment("all"); setJobPage(1); }}>&times;</button>
            </span>
          )}
          {jobSource !== "all" && (
            <span className="filter-tag">
              {jobSource}
              <button onClick={() => { setJobSource("all"); setJobPage(1); }}>&times;</button>
            </span>
          )}
          {jobHasRecruiter !== "all" && (
            <span className="filter-tag">
              {jobHasRecruiter === "true" ? "With Recruiter" : "Without Recruiter"}
              <button onClick={() => { setJobHasRecruiter("all"); setJobPage(1); }}>&times;</button>
            </span>
          )}
          <button
            className="clear-filters"
            onClick={() => {
              setJobSearch("");
              setJobDepartment("all");
              setJobSource("all");
              setJobHasRecruiter("all");
              setJobPage(1);
            }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="loading">
          <div className="spinner" />
          <p style={{ marginTop: 12 }}>
            {activeTab === "funding"
              ? "Loading funding data..."
              : activeTab === "sales-jobs"
              ? "Loading sales jobs..."
              : "Loading recruiters..."}
          </p>
        </div>
      ) : activeTab === "funding" ? (
        /* ─── Funding Table ─────────────────────── */
        fundings.length === 0 ? (
          <div className="empty-state">
            <h3>No funding rounds found</h3>
            <p>Run a scrape to populate the database, or adjust your filters.</p>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Round</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>Investors</th>
                    <th>Location</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {fundings.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <div className="company-name">
                          {f.company_website ? (
                            <a href={f.company_website} target="_blank" rel="noopener">
                              {f.company_name}
                            </a>
                          ) : f.company_name}
                        </div>
                        {f.company_description && (
                          <div className="company-desc" title={f.company_description}>
                            {f.company_description}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`round-badge ${roundBadgeClass(f.round_type_normalized)}`}>
                          {f.round_type_normalized}
                        </span>
                      </td>
                      <td className="amount">{formatAmount(f.amount_usd)}</td>
                      <td className="date">{formatDate(f.announced_date)}</td>
                      <td className="investors">
                        {f.lead_investors?.length > 0
                          ? f.lead_investors.join(", ")
                          : f.investors?.slice(0, 3).join(", ") || "\u2014"}
                      </td>
                      <td className="location">
                        {f.company_hq_location || f.company_hq_country || "\u2014"}
                      </td>
                      <td>
                        {f.source_url ? (
                          <a href={f.source_url} target="_blank" rel="noopener" className="source-badge">
                            {f.source}
                          </a>
                        ) : <span className="source-badge">{f.source}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </button>
              <span className="page-info">Page {page} of {totalPages} ({total} total)</span>
              <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Next
              </button>
            </div>
          </>
        )
      ) : activeTab === "sales-jobs" ? (
        /* ─── Sales Jobs Table ─────────────────── */
        salesJobs.length === 0 ? (
          <div className="empty-state">
            <h3>No sales jobs found yet</h3>
            <p>Click "Find Sales Jobs" to scan ATS platforms and the web for sales openings at tracked companies.</p>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => handleJobSort("company_name")}>
                      Company {sortIcon("company_name")}
                    </th>
                    <th className="sortable" onClick={() => handleJobSort("title")}>
                      Job Title {sortIcon("title")}
                    </th>
                    <th className="sortable" onClick={() => handleJobSort("department")}>
                      Department {sortIcon("department")}
                    </th>
                    <th>Location</th>
                    <th>Last Round</th>
                    <th>Recruiter</th>
                    <th>Contact</th>
                    <th className="sortable" onClick={() => handleJobSort("posted_date")}>
                      Source {sortIcon("posted_date")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {salesJobs.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <div className="company-name">
                          {j.company_website ? (
                            <a href={j.company_website} target="_blank" rel="noopener">
                              {j.company_name}
                            </a>
                          ) : j.company_name}
                        </div>
                        {j.company_hq_location && (
                          <div className="company-desc">{j.company_hq_location}</div>
                        )}
                      </td>
                      <td>
                        <a href={j.url} target="_blank" rel="noopener" className="job-title-link">
                          {j.title}
                        </a>
                        {j.posted_date && (
                          <div className="company-desc">Posted: {formatDate(j.posted_date)}</div>
                        )}
                      </td>
                      <td>
                        {j.department && (
                          <span className="dept-badge">{j.department}</span>
                        )}
                      </td>
                      <td className="location">{j.location || "\u2014"}</td>
                      <td>
                        {j.latest_round ? (
                          <div>
                            <span className={`round-badge ${roundBadgeClass(j.latest_round)}`}>
                              {j.latest_round}
                            </span>
                            {j.latest_amount && (
                              <div className="amount-small">{formatAmount(j.latest_amount)}</div>
                            )}
                          </div>
                        ) : "\u2014"}
                      </td>
                      <td className="recruiter-cell">
                        {j.recruiter_name ? (
                          <div>
                            <div className="recruiter-name">{j.recruiter_name}</div>
                            {j.recruiter_title && (
                              <div className="recruiter-title">{j.recruiter_title}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-dim">Not found</span>
                        )}
                      </td>
                      <td className="contact-cell">
                        {j.recruiter_email && (
                          <a href={`mailto:${j.recruiter_email}`} className="contact-link" title={j.recruiter_email}>
                            Email
                          </a>
                        )}
                        {j.recruiter_linkedin && (
                          <a href={j.recruiter_linkedin} target="_blank" rel="noopener" className="contact-link linkedin">
                            LinkedIn
                          </a>
                        )}
                        {!j.recruiter_email && !j.recruiter_linkedin && (
                          <span className="text-dim">{"\u2014"}</span>
                        )}
                      </td>
                      <td>
                        <span className="source-badge">{j.source}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button className="btn btn-secondary" disabled={jobPage <= 1} onClick={() => setJobPage(p => p - 1)}>
                Previous
              </button>
              <span className="page-info">Page {jobPage} of {jobTotalPages} ({jobTotal} total)</span>
              <button className="btn btn-secondary" disabled={jobPage >= jobTotalPages} onClick={() => setJobPage(p => p + 1)}>
                Next
              </button>
            </div>
          </>
        )
      ) : (
        /* ─── Recruiters Table ─────────────────── */
        recruiters.length === 0 ? (
          <div className="empty-state">
            <h3>No recruiters found yet</h3>
            <p>Click "Find Recruiters" to search LinkedIn and company websites for talent/recruiting contacts.</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Sales Jobs</th>
                  <th>Recruiter</th>
                  <th>Title</th>
                  <th>Email</th>
                  <th>LinkedIn</th>
                  <th>Confidence</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {recruitersByCompany.map(({ company, recruiters: recs }) =>
                  recs.map((r, idx) => (
                    <tr key={r.id}>
                      {idx === 0 ? (
                        <td rowSpan={recs.length}>
                          <div className="company-name">
                            {company.website ? (
                              <a href={company.website} target="_blank" rel="noopener">
                                {company.name}
                              </a>
                            ) : company.name}
                          </div>
                          {company.domain && (
                            <div className="company-desc">{company.domain}</div>
                          )}
                        </td>
                      ) : null}
                      {idx === 0 ? (
                        <td rowSpan={recs.length}>
                          <span className="tab-count" style={{ fontSize: 13 }}>
                            {company.salesJobCount}
                          </span>
                        </td>
                      ) : null}
                      <td>
                        <div className="recruiter-name">{r.name}</div>
                      </td>
                      <td>
                        {r.title ? (
                          <span className="dept-badge">{r.title}</span>
                        ) : (
                          <span className="text-dim">{"\u2014"}</span>
                        )}
                      </td>
                      <td>
                        {r.email ? (
                          <div>
                            <a href={`mailto:${r.email}`} className="contact-link" title={r.email}>
                              {r.email}
                            </a>
                            {r.email_verified === 1 ? (
                              <div style={{ marginTop: 2, color: "#22c55e", fontSize: "0.75rem" }}>verified</div>
                            ) : r.email_guessed === 1 ? (
                              <div style={{ marginTop: 2, color: "#f59e0b", fontSize: "0.75rem" }}>guessed</div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-dim">{"\u2014"}</span>
                        )}
                      </td>
                      <td>
                        {r.linkedin_url ? (
                          <a href={r.linkedin_url} target="_blank" rel="noopener" className="contact-link linkedin">
                            Profile
                          </a>
                        ) : (
                          <span className="text-dim">{"\u2014"}</span>
                        )}
                      </td>
                      <td>
                        <span className={`confidence-badge confidence-${r.confidence}`}>
                          {r.confidence}
                        </span>
                      </td>
                      <td>
                        <span className="source-badge">{r.source}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ─── Mount ──────────────────────────────────────────────────────

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
