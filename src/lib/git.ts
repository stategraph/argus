import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { config } from '../config.js';

// Track active git processes for cleanup during shutdown
const activeProcesses = new Set<ChildProcess>();

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

    // Track the process
    activeProcesses.add(proc);

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Auto-cleanup helper
    const cleanup = () => {
      clearTimeout(timer);
      activeProcesses.delete(proc);
    };

    const timer = setTimeout(() => {
      cleanup();
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
      cleanup();
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
      cleanup();
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

/**
 * Compute a two-dot diff between two commits, returning file-level patches
 * similar to GitHub's PRFile format.
 */
export async function computeCrossDiff(
  owner: string,
  repo: string,
  fromSha: string,
  toSha: string,
  token: string
): Promise<Array<{
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}>> {
  const repoPath = getRepoPath(owner, repo);

  await ensureRepo(owner, repo, token);
  await fetchRefs(owner, repo, [fromSha, toSha], token);

  // Get the list of changed files with stats
  const numstatResult = await execGit(
    ['diff', '--numstat', fromSha, toSha],
    repoPath,
    token
  );

  // Get the full diff with patches
  const diffResult = await execGit(
    ['diff', '--no-color', fromSha, toSha],
    repoPath,
    token
  );

  // Get file statuses (A/M/D/R)
  const statusResult = await execGit(
    ['diff', '--name-status', fromSha, toSha],
    repoPath,
    token
  );

  // Parse name-status into a map
  const statusMap = new Map<string, string>();
  for (const line of statusResult.stdout.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    const statusChar = parts[0][0]; // R100 -> R
    const filename = parts.length > 2 ? parts[2] : parts[1]; // renamed: use new name
    const statusName =
      statusChar === 'A' ? 'added' :
      statusChar === 'D' ? 'removed' :
      statusChar === 'R' ? 'renamed' :
      statusChar === 'C' ? 'copied' :
      'modified';
    statusMap.set(filename, statusName);
  }

  // Parse numstat for additions/deletions
  const statsMap = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstatResult.stdout.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
    const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
    const filename = parts[2];
    statsMap.set(filename, { additions, deletions });
  }

  // Split full diff into per-file patches
  const files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }> = [];

  const diffOutput = diffResult.stdout;
  const fileDiffs = diffOutput.split(/^diff --git /m).slice(1);

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split('\n');
    // Extract filename from the diff header: "a/path b/path"
    const headerMatch = lines[0].match(/^a\/(.*?) b\/(.*)$/);
    if (!headerMatch) continue;
    const filename = headerMatch[2];

    // Find where the patch starts (after the header lines)
    let patchStartIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('@@')) {
        patchStartIdx = i;
        break;
      }
    }

    const patch = patchStartIdx >= 0 ? lines.slice(patchStartIdx).join('\n').trimEnd() : undefined;
    const stats = statsMap.get(filename) || { additions: 0, deletions: 0 };

    files.push({
      filename,
      status: statusMap.get(filename) || 'modified',
      additions: stats.additions,
      deletions: stats.deletions,
      patch,
    });
  }

  return files;
}

export function cleanupGitProcesses(): void {
  if (activeProcesses.size === 0) return;

  console.log(`Terminating ${activeProcesses.size} active git processes...`);

  for (const proc of activeProcesses) {
    try {
      proc.kill('SIGTERM');
    } catch (err) {
      // Process may have already exited
    }
  }

  activeProcesses.clear();
}
