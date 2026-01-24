import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { config } from '../config.js';

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RangeDiffResult {
  output: string;
  hasChanges: boolean;
}

/**
 * Get the path to a bare git repository in the cache
 */
export function getRepoPath(owner: string, repo: string): string {
  return join(config.git.cacheDir, owner, `${repo}.git`);
}

/**
 * Build authenticated GitHub URL
 */
export function buildAuthUrl(owner: string, repo: string, token: string): string {
  return `https://oauth2:${token}@github.com/${owner}/${repo}.git`;
}

/**
 * Sanitize error messages to remove tokens
 */
export function sanitizeError(message: string, token: string): string {
  if (!token) return message;
  // Remove token from URLs and error messages
  return message.replace(new RegExp(token, 'g'), '***TOKEN***');
}

/**
 * Execute a git command with timeout
 */
async function execGit(
  args: string[],
  cwd: string,
  token?: string,
  timeout: number = config.git.commandTimeout
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      reject(new Error(`Git command timed out after ${timeout}ms`));
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;

      const result = {
        stdout,
        stderr,
        exitCode: code || 0,
      };

      if (code !== 0) {
        const sanitizedStderr = token ? sanitizeError(stderr, token) : stderr;
        reject(new Error(`Git command failed (exit ${code}): ${sanitizedStderr}`));
      } else {
        resolve(result);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (timedOut) return;
      const sanitizedMessage = token ? sanitizeError(err.message, token) : err.message;
      reject(new Error(`Git command error: ${sanitizedMessage}`));
    });
  });
}

/**
 * Ensure a bare clone exists in the cache
 */
export async function ensureRepo(owner: string, repo: string, token: string): Promise<void> {
  const repoPath = getRepoPath(owner, repo);
  const parentDir = dirname(repoPath);

  // Create parent directory if needed
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // If repo doesn't exist, create it
  if (!existsSync(repoPath)) {
    const authUrl = buildAuthUrl(owner, repo, token);
    try {
      await execGit(['clone', '--bare', authUrl, repoPath], parentDir, token);
    } catch (err: any) {
      throw new Error(`Failed to clone repository: ${sanitizeError(err.message, token)}`);
    }
  }
}

/**
 * Fetch specific refs from remote
 * Retries with deeper fetch if shallow clone error occurs
 */
export async function fetchRefs(
  owner: string,
  repo: string,
  refs: string[],
  token: string,
  depth?: number
): Promise<void> {
  const repoPath = getRepoPath(owner, repo);
  const authUrl = buildAuthUrl(owner, repo, token);

  const fetchDepth = depth || config.git.fetchDepth;
  const args = ['fetch', authUrl, '--depth', fetchDepth.toString(), ...refs];

  try {
    await execGit(args, repoPath, token);
  } catch (err: any) {
    const errorMsg = err.message.toLowerCase();

    // Check if it's a shallow clone error
    if (errorMsg.includes('shallow') || errorMsg.includes('unshallow')) {
      console.log(`Shallow fetch failed, retrying with depth ${config.git.fetchDeepDepth}`);
      const deepArgs = ['fetch', authUrl, '--depth', config.git.fetchDeepDepth.toString(), ...refs];
      try {
        await execGit(deepArgs, repoPath, token);
      } catch (deepErr: any) {
        throw new Error(`Failed to fetch refs (even with deep fetch): ${sanitizeError(deepErr.message, token)}`);
      }
    } else {
      throw new Error(`Failed to fetch refs: ${sanitizeError(err.message, token)}`);
    }
  }
}

/**
 * Compute merge-base between two refs
 */
export async function computeMergeBase(
  owner: string,
  repo: string,
  ref1: string,
  ref2: string,
  token: string
): Promise<string> {
  const repoPath = getRepoPath(owner, repo);

  await ensureRepo(owner, repo, token);
  await fetchRefs(owner, repo, [ref1, ref2], token);

  try {
    const result = await execGit(['merge-base', ref1, ref2], repoPath, token);
    return result.stdout.trim();
  } catch (err: any) {
    throw new Error(`Failed to compute merge-base: ${sanitizeError(err.message, token)}`);
  }
}

/**
 * Compute range-diff between two commit ranges
 */
export async function computeRangeDiff(
  owner: string,
  repo: string,
  oldBase: string,
  oldHead: string,
  newBase: string,
  newHead: string,
  token: string
): Promise<RangeDiffResult> {
  const repoPath = getRepoPath(owner, repo);

  await ensureRepo(owner, repo, token);
  await fetchRefs(owner, repo, [oldBase, oldHead, newBase, newHead], token);

  try {
    const result = await execGit(
      ['range-diff', `${oldBase}..${oldHead}`, `${newBase}..${newHead}`],
      repoPath,
      token
    );

    const output = result.stdout.trim();
    const hasChanges = output.length > 0;

    return { output, hasChanges };
  } catch (err: any) {
    throw new Error(`Failed to compute range-diff: ${sanitizeError(err.message, token)}`);
  }
}
