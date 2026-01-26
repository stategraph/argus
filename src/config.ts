import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string = ''): string {
  return process.env[name] || defaultValue;
}

export const config = {
  // Server
  port: parseInt(optional('PORT', '3000'), 10),
  host: optional('HOST', '0.0.0.0'),
  baseUrl: optional('BASE_URL', 'http://localhost:3000'),

  // Database (SQLite)
  databasePath: optional('DATABASE_PATH', './data/argus.db'),

  // GitHub Token
  githubToken: required('GITHUB_TOKEN'),

  // Cache
  cacheTtl: parseInt(optional('CACHE_TTL', '60'), 10),

  // UI defaults
  ui: {
    pollIntervalMs: 45000,
  },

  // Git operations
  git: {
    cacheDir: optional('GIT_CACHE_DIR', '/tmp/argus-git-cache'),
    fetchDepth: 200,
    fetchDeepDepth: 500,
    commandTimeout: 60000,
  },
} as const;
