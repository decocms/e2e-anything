import { getDb } from "../db";
import * as queries from "../db/queries";
import { generateOutreachCsv } from "../outreach/generate";

export function buildRoutes(dashboard: any) {
  return {
    // Dashboard
    "/": dashboard,

    // ─── Companies ─────────────────────────────────────────────
    "/api/companies": {
      GET: (req: Request) => {
        const url = new URL(req.url);
        const q = url.searchParams.get("q");
        const aiOnly = url.searchParams.get("ai_only") !== "false";
        const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
        const offset = (page - 1) * limit;

        const db = getDb();
        let results;

        if (q && q.trim()) {
          results = queries.searchCompanies(db, q, limit);
        } else {
          results = queries.listCompanies(db, { aiOnly, limit, offset });
        }

        // Parse JSON fields for API response
        const data = results.map(parseCompanyJsonFields);

        return Response.json({ data, page, limit, count: data.length });
      },
    },

    "/api/companies/:id": {
      GET: (req: Request) => {
        const db = getDb();
        const id = parseInt((req as any).params.id);
        const result = queries.getCompanyWithFundings(db, id);

        if (!result) {
          return Response.json({ error: "Company not found" }, { status: 404 });
        }

        const company = parseCompanyJsonFields(result);
        const fundings = (result as any).fundings?.map(parseFundingJsonFields) || [];

        return Response.json({ ...company, fundings });
      },
    },

    // ─── Funding Rounds ────────────────────────────────────────
    "/api/fundings": {
      GET: (req: Request) => {
        const url = new URL(req.url);
        const daysBack = Math.min(parseInt(url.searchParams.get("days") ?? "90"), 365);
        const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
        const offset = (page - 1) * limit;

        const db = getDb();
        const results = queries.getRecentFundings(db, daysBack, "Series A", limit, offset);
        const total = queries.getTotalFundingsCount(db, daysBack);

        const data = results.map((r) => ({
          ...parseFundingJsonFields(r),
          company_name: r.company_name,
          company_description: r.company_description,
          company_website: r.company_website,
          company_domain: r.company_domain,
          company_hq_location: r.company_hq_location,
          company_hq_country: r.company_hq_country,
          company_sectors: safeJsonParse(r.company_sectors, []),
          company_is_ai_native: r.company_is_ai_native,
        }));

        return Response.json({
          data,
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        });
      },
    },

    // ─── Stats ────────────────────────────────────────────────
    "/api/stats": {
      GET: (_req: Request) => {
        const db = getDb();
        return Response.json(queries.getStats(db));
      },
    },

    // ─── Scrape Runs ──────────────────────────────────────────
    "/api/scrape-runs": {
      GET: (_req: Request) => {
        const db = getDb();
        return Response.json(queries.getRecentScrapeRuns(db));
      },
    },

    // ─── Trigger Scrape ───────────────────────────────────────
    "/api/scrape": {
      POST: async (_req: Request) => {
        try {
          const { runScrape } = await import("../index");
          // Run async, don't block the response
          runScrape().catch((err: unknown) => console.error("Scrape error:", err));
          return Response.json({ status: "started", message: "Scrape job started in background" });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      },
    },

    // ─── Sales Jobs ─────────────────────────────────────────────
    "/api/jobs/sales": {
      GET: (req: Request) => {
        const url = new URL(req.url);
        const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
        const offset = (page - 1) * limit;

        const filters: queries.SalesJobFilters = {};
        const search = url.searchParams.get("q");
        if (search) filters.search = search;
        const dept = url.searchParams.get("department");
        if (dept) filters.department = dept;
        const source = url.searchParams.get("source");
        if (source) filters.source = source;
        const hasRecruiter = url.searchParams.get("has_recruiter");
        if (hasRecruiter === "true") filters.hasRecruiter = true;
        else if (hasRecruiter === "false") filters.hasRecruiter = false;
        const sortBy = url.searchParams.get("sort") as any;
        if (sortBy) filters.sortBy = sortBy;
        const sortDir = url.searchParams.get("dir") as any;
        if (sortDir) filters.sortDir = sortDir;

        const db = getDb();
        const results = queries.getSalesJobs(db, limit, offset, filters);
        const total = queries.getTotalSalesJobsCount(db, filters);

        return Response.json({
          data: results.map(r => ({
            ...r,
            company_sectors: safeJsonParse(r.company_sectors, []),
          })),
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        });
      },
    },

    "/api/jobs/with-recruiters": {
      GET: (_req: Request) => {
        const db = getDb();
        const results = queries.getJobsWithRecruiters(db, 200);
        return Response.json({
          data: results.map(r => ({
            ...r,
            company_sectors: safeJsonParse(r.company_sectors, []),
          })),
          count: results.length,
        });
      },
    },

    "/api/jobs/stats": {
      GET: (_req: Request) => {
        const db = getDb();
        return Response.json(queries.getJobStats(db));
      },
    },

    "/api/jobs/company/:id": {
      GET: (req: Request) => {
        const db = getDb();
        const id = parseInt((req as any).params.id);
        const jobs = queries.getJobsByCompanyId(db, id);
        return Response.json({ data: jobs });
      },
    },

    // ─── Trigger Job Scrape ────────────────────────────────────
    "/api/jobs/scrape": {
      POST: async (_req: Request) => {
        try {
          const { runJobScrape } = await import("../jobs/index");
          runJobScrape().catch((err: unknown) => console.error("Job scrape error:", err));
          return Response.json({ status: "started", message: "Job scrape started in background" });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      },
    },

    // ─── Manual Company Add ────────────────────────────────────
    "/api/companies/add": {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { name: string; website?: string; domain?: string; sectors?: string[] };
          const db = getDb();
          const { normalizeName, extractDomain } = await import("../lib/normalize");

          const normalizedName = normalizeName(body.name);
          if (!normalizedName) {
            return Response.json({ error: "Invalid company name" }, { status: 400 });
          }

          // Check if already exists
          const existing = queries.findCompanyByNormalizedName(db, normalizedName);
          if (existing) {
            return Response.json({ id: existing.id, name: existing.name, status: "already_exists" });
          }

          const domain = body.domain || (body.website ? extractDomain(body.website) : null);

          const id = queries.insertCompany(db, {
            name: body.name,
            normalized_name: normalizedName,
            website: body.website || null,
            domain: domain,
            sectors: body.sectors ? JSON.stringify(body.sectors) : "[]",
            sources: JSON.stringify(["manual"]),
            is_ai_native: 1,
          });

          return Response.json({ id, name: body.name, status: "created" });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      },
    },

    // ─── Recruiters ────────────────────────────────────────────
    "/api/recruiters": {
      GET: (req: Request) => {
        const url = new URL(req.url);
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200"), 500);

        const db = getDb();
        const results = queries.getRecruitersWithCompanies(db, limit);
        const stats = queries.getRecruiterStats(db);

        return Response.json({ data: results, stats });
      },
    },

    "/api/recruiters/company/:id": {
      GET: (req: Request) => {
        const db = getDb();
        const id = parseInt((req as any).params.id);
        const recruiters = queries.getRecruitersByCompanyId(db, id);
        return Response.json({ data: recruiters });
      },
    },

    "/api/recruiters/stats": {
      GET: (_req: Request) => {
        const db = getDb();
        return Response.json(queries.getRecruiterStats(db));
      },
    },

    // ─── Trigger Recruiter Finder ────────────────────────────
    "/api/recruiters/find": {
      POST: async (_req: Request) => {
        try {
          const { runRecruiterFinder } = await import("../jobs/recruiter-finder");
          runRecruiterFinder().catch((err: unknown) => console.error("Recruiter finder error:", err));
          return Response.json({ status: "started", message: "Recruiter finder started in background" });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      },
    },

    // ─── Export ────────────────────────────────────────────────
    "/api/export/csv": {
      GET: (_req: Request) => {
        const db = getDb();
        const fundings = queries.getRecentFundings(db, 90, "Series A", 10000, 0);

        const headers = [
          "Company", "Description", "Website", "Location", "Country",
          "Sectors", "Round Type", "Amount (USD)", "Date", "Investors",
          "Lead Investors", "Source", "Source URL",
        ];

        const rows = fundings.map((f) => [
          escapeCsv(f.company_name),
          escapeCsv(f.company_description || ""),
          escapeCsv(f.company_website || ""),
          escapeCsv(f.company_hq_location || ""),
          escapeCsv(f.company_hq_country || ""),
          escapeCsv(safeJsonParse(f.company_sectors, []).join("; ")),
          escapeCsv(f.round_type_normalized),
          f.amount_usd ? String(f.amount_usd) : "",
          f.announced_date,
          escapeCsv(safeJsonParse(f.investors, []).join("; ")),
          escapeCsv(safeJsonParse(f.lead_investors, []).join("; ")),
          escapeCsv(f.source),
          escapeCsv(f.source_url || ""),
        ].join(","));

        const csv = [headers.join(","), ...rows].join("\n");

        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="ai-funding-${new Date().toISOString().split("T")[0]}.csv"`,
          },
        });
      },
    },
    // ─── Sales Jobs CSV Export ────────────────────────────────
    "/api/export/sales-jobs-csv": {
      GET: (_req: Request) => {
        const db = getDb();
        const jobs = queries.getSalesJobs(db, 10000, 0);

        const headers = [
          "Company", "Website", "Location", "Sectors", "Latest Round", "Amount (USD)",
          "Job Title", "Department", "Job Location", "Job URL", "Posted Date",
          "Recruiter Name", "Recruiter Title", "Recruiter Email", "Recruiter LinkedIn",
        ];

        const rows = jobs.map((j) => [
          escapeCsv(j.company_name),
          escapeCsv(j.company_website || ""),
          escapeCsv(j.company_hq_location || ""),
          escapeCsv(safeJsonParse(j.company_sectors, []).join("; ")),
          escapeCsv(j.latest_round || ""),
          j.latest_amount ? String(j.latest_amount) : "",
          escapeCsv(j.title),
          escapeCsv(j.department || ""),
          escapeCsv(j.location || ""),
          escapeCsv(j.url),
          j.posted_date || "",
          escapeCsv(j.recruiter_name || ""),
          escapeCsv(j.recruiter_title || ""),
          escapeCsv(j.recruiter_email || ""),
          escapeCsv(j.recruiter_linkedin || ""),
        ].join(","));

        const csv = [headers.join(","), ...rows].join("\n");

        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="ai-sales-jobs-${new Date().toISOString().split("T")[0]}.csv"`,
          },
        });
      },
    },

    // ─── Outreach CSV Export ──────────────────────────────────────
    "/api/export/outreach-csv": {
      GET: (req: Request) => {
        const url = new URL(req.url);
        const verifiedOnly = url.searchParams.get("verified_only") === "true";

        const { csv, count, verifiedCount } = generateOutreachCsv(verifiedOnly);
        const suffix = verifiedOnly ? "-verified" : "";

        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="outreach${suffix}-${new Date().toISOString().split("T")[0]}.csv"`,
          },
        });
      },
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────

function safeJsonParse(str: string | null, fallback: any = []): any {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function parseCompanyJsonFields(company: any) {
  return {
    ...company,
    sectors: safeJsonParse(company.sectors, []),
    sources: safeJsonParse(company.sources, []),
  };
}

function parseFundingJsonFields(funding: any) {
  return {
    ...funding,
    investors: safeJsonParse(funding.investors, []),
    lead_investors: safeJsonParse(funding.lead_investors, []),
  };
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
