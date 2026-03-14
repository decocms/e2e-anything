/**
 * Company Name Cleanup
 *
 * Fixes article-fragment company names in the DB and removes junk entries.
 * Run: bun src/jobs/cleanup-company-names.ts [--dry-run]
 */

import { Database } from "bun:sqlite";

const DB_PATH = "data/funding.sqlite";
const dryRun = process.argv.includes("--dry-run");

const db = new Database(DB_PATH);

// ─── 1. Junk entries: news/media domains that aren't real companies ───

const JUNK_IDS = db.prepare(`
  SELECT id FROM companies
  WHERE domain IN (
    'prnewswire.com','globenewswire.com','businesswire.com',
    'finance.yahoo.com','fortune.com','observer.com','reuters.com',
    'aol.com','play.google.com','facebook.com','criya.co',
    'infomarine.net','chai-research.com'
  )
`).all() as { id: number }[];

console.log(`\nFound ${JUNK_IDS.length} junk entries (news/media domains) to mark as not AI-native.`);

// ─── 2. Name fixes: extract real company name from article fragments ───

const NAME_FIXES: Record<number, string> = {
  15:  "DepthFirst",
  67:  "Nscale",
  83:  "Anthropic",
  89:  "Parloa",
  91:  "PolyAI",
  96:  "OpenEvidence",
  103: "Synthesia",
  133: "Mirelo",
  145: "SurrealDB",
  169: "Quadric",
  200: "DepthFirst",
  211: "Astelia",
  224: "Uptiq",
  248: "Apptronik",
  250: "Mytra Robotics",
  263: "Wayve",
  274: "Oxa",
  277: "Chai Discovery",
  279: "Chai Discovery",
  282: "Antiverse",
  289: "Chai Discovery",
  290: "Chai Discovery",
  292: "Chai Discovery",
  302: "Harmattan AI",
  306: "Lio",
  336: "BeyondMath",
  341: "Criya",
  372: "Rhoda AI",
  447: "Complyance",
  465: "Midi Health",
  473: "Ricursive Intelligence",
  478: "Orbital",
  485: "Vention",
  519: "Harmattan AI",
  529: "Moonshot AI",
  553: "Chai Discovery",
};

// Show what we'll fix
console.log(`\nFound ${Object.keys(NAME_FIXES).length} companies with article-fragment names to fix:\n`);

const currentNames = db.prepare(`
  SELECT id, name, domain FROM companies WHERE id IN (${Object.keys(NAME_FIXES).join(",")})
`).all() as { id: number; name: string; domain: string }[];

for (const row of currentNames) {
  const newName = NAME_FIXES[row.id];
  if (newName) {
    console.log(`  [${row.id}] "${row.name}" → "${newName}" (${row.domain})`);
  }
}

// ─── 3. Deduplicate: some companies appear multiple times ───

// Find duplicates by domain after fixes
const dupes = db.prepare(`
  SELECT domain, GROUP_CONCAT(id) as ids, COUNT(*) as cnt
  FROM companies
  WHERE is_ai_native = 1
    AND domain IS NOT NULL AND domain != ''
  GROUP BY LOWER(domain)
  HAVING cnt > 1
  ORDER BY cnt DESC
`).all() as { domain: string; ids: string; cnt: number }[];

console.log(`\n${dupes.length} domains have duplicate company entries:`);
for (const d of dupes.slice(0, 15)) {
  console.log(`  ${d.domain}: ids [${d.ids}] (${d.cnt} entries)`);
}

if (dryRun) {
  console.log("\n[dry-run] No changes made.\n");
  db.close();
  process.exit(0);
}

// ─── Apply changes ───

console.log("\nApplying changes...");

// 1. Mark junk as not AI-native
if (JUNK_IDS.length > 0) {
  const ids = JUNK_IDS.map(r => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(
    `UPDATE companies SET is_ai_native = 0 WHERE id IN (${placeholders})`
  ).run(...ids);
  console.log(`  Marked ${result.changes} junk entries as not AI-native`);
}

// 2. Fix company names
let namesFixed = 0;
const updateStmt = db.prepare("UPDATE companies SET name = ? WHERE id = ?");
for (const [idStr, newName] of Object.entries(NAME_FIXES)) {
  const id = parseInt(idStr);
  updateStmt.run(newName, id);
  namesFixed++;
}
console.log(`  Fixed ${namesFixed} company names`);

// 3. Merge duplicates: keep the lowest ID, reassign recruiters/funding/jobs
let mergedCount = 0;
for (const d of dupes) {
  const ids = d.ids.split(",").map(Number).sort((a, b) => a - b);
  const keepId = ids[0];
  const removeIds = ids.slice(1);

  if (removeIds.length === 0) continue;

  const removePlaceholders = removeIds.map(() => "?").join(",");

  // Reassign recruiters
  db.prepare(
    `UPDATE OR IGNORE company_recruiters SET company_id = ? WHERE company_id IN (${removePlaceholders})`
  ).run(keepId, ...removeIds);

  // Delete any recruiter duplicates that couldn't be reassigned
  db.prepare(
    `DELETE FROM company_recruiters WHERE company_id IN (${removePlaceholders})`
  ).run(...removeIds);

  // Reassign funding rounds
  db.prepare(
    `UPDATE OR IGNORE funding_rounds SET company_id = ? WHERE company_id IN (${removePlaceholders})`
  ).run(keepId, ...removeIds);
  db.prepare(
    `DELETE FROM funding_rounds WHERE company_id IN (${removePlaceholders})`
  ).run(...removeIds);

  // Reassign job openings
  db.prepare(
    `UPDATE OR IGNORE job_openings SET company_id = ? WHERE company_id IN (${removePlaceholders})`
  ).run(keepId, ...removeIds);
  db.prepare(
    `DELETE FROM job_openings WHERE company_id IN (${removePlaceholders})`
  ).run(...removeIds);

  // Mark duplicates as not AI-native (soft delete)
  db.prepare(
    `UPDATE companies SET is_ai_native = 0 WHERE id IN (${removePlaceholders})`
  ).run(...removeIds);

  mergedCount += removeIds.length;
}
console.log(`  Merged ${mergedCount} duplicate company entries`);

// Summary
const stats = db.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN is_ai_native = 1 THEN 1 ELSE 0 END) as ai_native,
    SUM(CASE WHEN is_ai_native = 1 AND LENGTH(name) > 30 THEN 1 ELSE 0 END) as still_long
  FROM companies
`).get() as { total: number; ai_native: number; still_long: number };

console.log(`\n===================================================`);
console.log(`  Company Name Cleanup Complete`);
console.log(`---------------------------------------------------`);
console.log(`  Junk entries removed:    ${JUNK_IDS.length}`);
console.log(`  Names fixed:             ${namesFixed}`);
console.log(`  Duplicates merged:       ${mergedCount}`);
console.log(`  AI-native companies:     ${stats.ai_native}`);
console.log(`  Still long (>30 chars):  ${stats.still_long}`);
console.log(`===================================================\n`);

db.close();
