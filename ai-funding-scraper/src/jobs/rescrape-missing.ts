/**
 * Re-scrape jobs for companies that had no sales roles found.
 * Targets: ATS platforms (Greenhouse, Lever, Ashby, Workable) + career pages + Exa search
 * Only processes companies from /tmp/no_sales_companies.json
 */

import { getDb, closeDb } from "../db";
import * as queries from "../db/queries";
import { scrapeATSPlatforms, type ScrapedJob } from "./ats-scraper";
import { searchExaForCompanyJobs } from "./exa-jobs";
import type { Company } from "../db/queries";

async function main() {
  const db = getDb();

  // Load the target companies
  const targetFile = Bun.file("/tmp/no_sales_companies.json");
  const targets: { name: string; domain: string; website: string }[] = await targetFile.json();

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  Re-scraping ${targets.length} companies for sales jobs`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  let totalJobs = 0;
  let totalSalesJobs = 0;
  let companiesWithSales = 0;

  // Phase 1: ATS + Career page scraping
  console.log("▶ Phase 1: ATS platforms + Career pages...\n");

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const progress = `[${i + 1}/${targets.length}]`;

    try {
      const jobs = await scrapeATSPlatforms(target.name, target.domain);

      if (jobs.length > 0) {
        const salesJobs = jobs.filter(j => j.isSales);
        console.log(`  ${progress} ${target.name}: ${jobs.length} jobs (${salesJobs.length} sales) ✓`);

        // Get company ID
        const companyRow = db.prepare("SELECT id FROM companies WHERE name = ?").get(target.name) as any;
        if (companyRow) {
          for (const job of jobs) {
            try {
              queries.insertJobOpening(db, {
                company_id: companyRow.id,
                title: job.title,
                department: job.department,
                location: job.location,
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
              totalJobs++;
              if (job.isSales) totalSalesJobs++;
            } catch {
              // Duplicate or constraint error, skip
            }
          }
          if (salesJobs.length > 0) companiesWithSales++;
        }
      } else {
        console.log(`  ${progress} ${target.name}: no jobs found`);
      }
    } catch (err) {
      console.log(`  ${progress} ${target.name}: error - ${(err as Error).message?.slice(0, 50)}`);
    }

    // Small delay between companies
    await Bun.sleep(300);
  }

  console.log(`\n  Phase 1 done: ${totalJobs} jobs stored, ${totalSalesJobs} sales jobs\n`);

  // Phase 2: Exa company-specific search
  console.log("▶ Phase 2: Exa.ai company-specific search...\n");

  // Get company objects from DB for Exa search
  const companyObjects: Company[] = [];
  for (const target of targets) {
    const row = db.prepare("SELECT * FROM companies WHERE name = ?").get(target.name) as any;
    if (row) {
      companyObjects.push(row);
    }
  }

  try {
    const exaResults = await searchExaForCompanyJobs(companyObjects, companyObjects.length);

    for (const result of exaResults) {
      if (!result.matchedCompanyId) continue;

      try {
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
        totalJobs++;
        totalSalesJobs++;
      } catch {
        // Duplicate
      }
    }

    console.log(`  Exa found ${exaResults.length} additional sales jobs\n`);
  } catch (err) {
    console.log(`  Exa search failed: ${(err as Error).message}\n`);
  }

  // Summary
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`  RESULTS`);
  console.log(`  Total jobs stored:        ${totalJobs}`);
  console.log(`  Sales jobs found:         ${totalSalesJobs}`);
  console.log(`  Companies with sales:     ${companiesWithSales}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  closeDb();
}

main().catch(console.error);
