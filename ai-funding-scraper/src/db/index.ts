import { Database } from "bun:sqlite";
import { SCHEMA_SQL } from "./schema";
import { resolve, dirname } from "path";

// Resolve DB path relative to the project root
const PROJECT_ROOT = resolve(dirname(import.meta.dir), "..");
const DB_PATH = resolve(PROJECT_ROOT, "data", "funding.sqlite");

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH, { create: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA busy_timeout = 5000");
    db.exec(SCHEMA_SQL);

    // Migrations for existing databases
    try {
      db.run("ALTER TABLE company_recruiters ADD COLUMN email_verified INTEGER DEFAULT 0");
    } catch { /* column already exists */ }
    try {
      db.run("ALTER TABLE company_recruiters ADD COLUMN email_source TEXT DEFAULT 'guess'");
    } catch { /* column already exists */ }
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close(false);
    db = null;
  }
}
