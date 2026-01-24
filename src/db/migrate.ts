import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { initDb, getDb, exec, query, closeDb } from './index.js';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env.DATABASE_PATH || './data/argus.db';

async function migrate() {
  try {
    // Initialize database
    initDb(dbPath);
    const db = getDb();

    // Create migrations table if not exists
    exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Get applied migrations
    const { rows: applied } = query<{ name: string }>(
      'SELECT name FROM migrations ORDER BY id'
    );
    const appliedNames = new Set(applied.map(r => r.name));

    // Get migration files
    const migrationsDir = join(process.cwd(), 'migrations');
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Apply pending migrations
    for (const file of files) {
      if (appliedNames.has(file)) {
        console.log(`✓ ${file} (already applied)`);
        continue;
      }

      console.log(`→ Applying ${file}...`);
      const sql = readFileSync(join(migrationsDir, file), 'utf8');

      // SQLite transactions
      try {
        exec('BEGIN TRANSACTION');
        exec(sql);
        exec(`INSERT INTO migrations (name) VALUES ('${file}')`);
        exec('COMMIT');
        console.log(`✓ ${file} applied`);
      } catch (err) {
        exec('ROLLBACK');
        throw err;
      }
    }

    console.log('\nAll migrations applied successfully.');
    console.log(`Database: ${dbPath}`);
  } finally {
    closeDb();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
