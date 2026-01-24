import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

let db: Database.Database | null = null;

export function initDb(dbPath: string): Database.Database {
  // Ensure directory exists
  const dir = dirname(dbPath);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb first.');
  }
  return db;
}

// Query helper that mimics pg's interface for easier migration
export function query<T = any>(
  sql: string,
  params: any[] = []
): { rows: T[] } {
  const database = getDb();

  // Check if it's a SELECT query
  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');

  if (isSelect) {
    const stmt = database.prepare(sql);
    const rows = stmt.all(...params) as T[];
    return { rows };
  } else {
    const stmt = database.prepare(sql);
    stmt.run(...params);
    return { rows: [] };
  }
}

// Run a single statement (for migrations, etc.)
export function run(sql: string, params: any[] = []): Database.RunResult {
  const database = getDb();
  const stmt = database.prepare(sql);
  return stmt.run(...params);
}

// Execute multiple statements (for migrations)
export function exec(sql: string): void {
  const database = getDb();
  database.exec(sql);
}

export function closeDb(): void {
  if (!db) return;

  const dbRef = db;
  db = null;

  try {
    // Force WAL checkpoint to ensure all data is written
    dbRef.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.error('WAL checkpoint failed:', err);
  }

  try {
    dbRef.close();
  } catch (err) {
    console.error('Database close failed:', err);
  }
}
