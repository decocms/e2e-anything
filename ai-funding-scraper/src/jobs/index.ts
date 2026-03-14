/**
 * Job Scraper Orchestrator
 *
 * For each AI-native company in the database:
 * 1. Check ATS platforms (Greenhouse, Lever, Ashby, Workable)
 * 2. Use Exa semantic search for sales job postings
 * 3. Extract recruiter info from job pages
 * 4. Store results in the database
 */

import { getDb, closeDb } from "../db";
import * as queries from "../db/queries";
import { scrapeATSPlatforms, enrichJobWithRecruiter, type ScrapedJob } from "./ats-scraper";
import { searchExaForSalesJobs, searchExaForCompanyJobs } from "./exa-jobs";

export async function runJobScrape(): Promise<{
  companiesChecked: number;
  jobsFound: number;
  salesJobsFound: number;
  jobsWithRecruiters: number;
}> {
  const db = getDb();
  const runId = queries.startJobScrapeRun(db);

  const summary = {
    companiesChecked: 0,
    jobsFound: 0,
    salesJobsFound: 0,
    jobsWithRecruiters: 0,
  };

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Job Scraper — Finding sales jobs & recruiters");
  console.log("═══════════════════════════════════════════════════════\n");

  try {
    // Get all AI-native companies
    const companies = queries.getAllAINativeCompanies(db);
    console.log(`  Found ${companies.length} AI-native companies to check\n`);

    // ─── Phase 1: Exa Semantic Search ──────────────────────────
    console.log("▶ Phase 1: Exa.ai semantic search for sales jobs...");
    const exaGenericResults = await searchExaForSalesJobs(companies);

    // Store Exa generic results
    for (const result of exaGenericResults) {
      if (!result.matchedCompanyId) continue; // Can only store if matched to a company

      queries.insertJobOpening(db, {
        company_id: result.matchedCompanyId,
        title: result.title,
        department: result.department,
        location: result.location,
        url: result.url,
        description_snippet: result.descriptionSnippet,
        is_sales: result.isSales ? 1 : 0,
        recruiter_name: result.recruiterName,
        recruiter_title: result.recruiterTitle,
        recruiter_email: result.recruiterEmail,
        recruiter_linkedin: result.recruiterLinkedin,
        posted_date: result.postedDate,
        source: result.source,
      });

      summary.jobsFound++;
      if (result.isSales) summary.salesJobsFound++;
      if (result.recruiterName || result.recruiterEmail) summary.jobsWithRecruiters++;
    }

    console.log(`  ✓ Exa generic: ${exaGenericResults.length} jobs found, ${exaGenericResults.filter(r => r.matchedCompanyId).length} matched to companies\n`);

    // ─── Phase 2: Exa Company-Specific Searches ───────────────
    console.log("▶ Phase 2: Exa.ai company-specific job searches...");
    const exaCompanyResults = await searchExaForCompanyJobs(companies, 50);

    for (const result of exaCompanyResults) {
      if (!result.matchedCompanyId) continue;

      queries.insertJobOpening(db, {
        company_id: result.matchedCompanyId,
        title: result.title,
        department: result.department,
        location: result.location,
        url: result.url,
        description_snippet: result.descriptionSnippet,
        is_sales: result.isSales ? 1 : 0,
        recruiter_name: result.recruiterName,
        recruiter_title: result.recruiterTitle,
        recruiter_email: result.recruiterEmail,
        recruiter_linkedin: result.recruiterLinkedin,
        posted_date: result.postedDate,
        source: result.source,
      });

      summary.jobsFound++;
      if (result.isSales) summary.salesJobsFound++;
      if (result.recruiterName || result.recruiterEmail) summary.jobsWithRecruiters++;
    }

    console.log(`  ✓ Exa company-specific: ${exaCompanyResults.length} additional jobs\n`);

    // ─── Phase 3: ATS Platform Scraping ───────────────────────
    console.log("▶ Phase 3: Checking ATS platforms (Greenhouse, Lever, Ashby, Workable)...");

    // Process in batches of 10 for rate limiting
    const batchSize = 10;
    let atsJobsTotal = 0;
    let atsSalesTotal = 0;

    for (let i = 0; i < companies.length; i += batchSize) {
      const batch = companies.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (company) => {
          const jobs = await scrapeATSPlatforms(company.name, company.domain);
          return { company, jobs };
        })
      );

      for (const result of batchResults) {
        if (result.status !== "fulfilled") continue;
        const { company, jobs } = result.value;

        summary.companiesChecked++;

        for (const job of jobs) {
          queries.insertJobOpening(db, {
            company_id: company.id,
            title: job.title,
            department: job.department,
            location: job.location,
            employment_type: job.employmentType,
            url: job.url,
            description_snippet: job.descriptionSnippet,
            is_sales: job.isSales ? 1 : 0,
            recruiter_name: job.recruiterName,
            recruiter_title: job.recruiterTitle,
            recruiter_email: job.recruiterEmail,
            recruiter_linkedin: job.recruiterLinkedin,
            posted_date: job.postedDate,
            source: job.source,
          });

          summary.jobsFound++;
          if (job.isSales) {
            summary.salesJobsFound++;
            atsSalesTotal++;
          }
          atsJobsTotal++;
        }
      }

      if (i % 50 === 0 && i > 0) {
        console.log(`  [ats] Checked ${i}/${companies.length} companies (${atsJobsTotal} jobs, ${atsSalesTotal} sales)...`);
      }
    }

    console.log(`  ✓ ATS platforms: ${atsJobsTotal} jobs found (${atsSalesTotal} sales) across ${summary.companiesChecked} companies\n`);

    // ─── Phase 4: Enrich sales jobs with recruiter info ───────
    console.log("▶ Phase 4: Enriching sales jobs with recruiter info...");

    // Get all sales jobs without recruiter info
    const salesJobsWithoutRecruiter = db.prepare(`
      SELECT * FROM job_openings
      WHERE is_sales = 1 AND recruiter_name IS NULL AND recruiter_email IS NULL
      ORDER BY created_at DESC
      LIMIT 100
    `).all() as queries.JobOpening[];

    let enriched = 0;
    for (const job of salesJobsWithoutRecruiter) {
      try {
        const enrichedJob = await enrichJobWithRecruiter({
          title: job.title,
          department: job.department,
          location: job.location,
          employmentType: job.employment_type,
          url: job.url,
          descriptionSnippet: job.description_snippet,
          isSales: true,
          recruiterName: null,
          recruiterTitle: null,
          recruiterEmail: null,
          recruiterLinkedin: null,
          postedDate: job.posted_date,
          source: job.source,
        });

        if (enrichedJob.recruiterName || enrichedJob.recruiterEmail || enrichedJob.recruiterLinkedin) {
          db.prepare(`
            UPDATE job_openings SET
              recruiter_name = $name,
              recruiter_title = $title,
              recruiter_email = $email,
              recruiter_linkedin = $linkedin,
              updated_at = datetime('now')
            WHERE id = $id
          `).run({
            $id: job.id,
            $name: enrichedJob.recruiterName,
            $title: enrichedJob.recruiterTitle,
            $email: enrichedJob.recruiterEmail,
            $linkedin: enrichedJob.recruiterLinkedin,
          });
          enriched++;
          summary.jobsWithRecruiters++;
        }
      } catch {
        // Skip enrichment failures
      }
    }

    console.log(`  ✓ Enriched ${enriched} jobs with recruiter info\n`);

    // Complete the run
    queries.completeJobScrapeRun(db, runId, summary.companiesChecked, summary.jobsFound, summary.salesJobsFound);

  } catch (err) {
    console.error("Job scrape failed:", err);
    db.prepare(
      "UPDATE job_scrape_runs SET completed_at = datetime('now'), status = 'failed', error_message = $err WHERE id = $id"
    ).run({ $id: runId, $err: String(err) });
  }

  // Print summary
  const jobStats = queries.getJobStats(db);

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Job Scrape Complete!");
  console.log(`  Companies checked: ${summary.companiesChecked}`);
  console.log(`  Total jobs found: ${summary.jobsFound}`);
  console.log(`  Sales jobs: ${summary.salesJobsFound}`);
  console.log(`  Jobs with recruiter info: ${summary.jobsWithRecruiters}`);
  console.log("───────────────────────────────────────────────────────");
  console.log("  Database totals:");
  console.log(`    Total job listings: ${jobStats.total_jobs}`);
  console.log(`    Sales jobs: ${jobStats.sales_jobs}`);
  console.log(`    Companies with sales openings: ${jobStats.companies_with_sales_jobs}`);
  console.log(`    Jobs with recruiter identified: ${jobStats.jobs_with_recruiters}`);
  console.log("═══════════════════════════════════════════════════════\n");

  return summary;
}

// ─── CLI Entry Point ────────────────────────────────────────────

if (import.meta.main) {
  console.log(`\n🔍 Job Scraper started at ${new Date().toISOString()}\n`);

  try {
    const result = await runJobScrape();
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  } finally {
    closeDb();
  }
}
