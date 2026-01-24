import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { query } from '../db/index.js';

// Create an Octokit instance with the configured token
export function createUserOctokit(accessToken?: string): Octokit {
  return new Octokit({ auth: accessToken || config.githubToken });
}

// API response types
export interface PRData {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: {
    login: string;
    avatar_url: string;
  };
  base: {
    ref: string;
    sha: string;
    repo: {
      full_name: string;
    };
  };
  head: {
    ref: string;
    sha: string;
    repo: {
      full_name: string;
    } | null;
  };
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  mergeable: boolean | null;
  mergeable_state: string;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  draft: boolean;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export interface ReviewComment {
  id: number;
  user: {
    login: string;
    avatar_url: string;
  };
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  side: 'LEFT' | 'RIGHT';
  commit_id: string;
  original_commit_id: string;
  created_at: string;
  updated_at: string;
  in_reply_to_id?: number;
  html_url: string;
  diff_hunk: string;
}

export interface IssueComment {
  id: number;
  user: {
    login: string;
    avatar_url: string;
  };
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface PRFile {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

// Fetch PR data with caching
export async function fetchPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRData> {
  const cacheKey = `pr:${owner}/${repo}#${prNumber}`;

  // Check cache first
  const { rows: cached } = query<{ data: string; etag: string }>(
    `SELECT data, etag FROM api_cache
     WHERE cache_key = ? AND expires_at > datetime('now')`,
    [cacheKey]
  );

  const headers: Record<string, string> = {};
  if (cached.length > 0 && cached[0].etag) {
    headers['If-None-Match'] = cached[0].etag;
  }

  try {
    const response = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      headers,
    });

    const etag = response.headers.etag || null;

    // Update cache (SQLite UPSERT)
    query(
      `INSERT INTO api_cache (cache_key, etag, data, fetched_at, expires_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now', '+${config.cacheTtl} seconds'))
       ON CONFLICT (cache_key) DO UPDATE SET
         etag = excluded.etag,
         data = excluded.data,
         fetched_at = datetime('now'),
         expires_at = datetime('now', '+${config.cacheTtl} seconds')`,
      [cacheKey, etag, JSON.stringify(response.data)]
    );

    return response.data as PRData;
  } catch (err: any) {
    if (err.status === 304 && cached.length > 0) {
      // Not modified, return cached data
      return JSON.parse(cached[0].data) as PRData;
    }
    throw err;
  }
}

// Fetch PR files
export async function fetchPRFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRFile[]> {
  const response = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 300,
  });

  return response.data as PRFile[];
}

// Fetch PR diff (raw)
export async function fetchPRDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: {
      format: 'diff',
    },
  });

  return response.data as unknown as string;
}

// Fetch checks for a commit
export async function fetchChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<CheckRun[]> {
  const response = await octokit.checks.listForRef({
    owner,
    repo,
    ref,
    per_page: 100,
  });

  return response.data.check_runs as CheckRun[];
}

// Fetch combined status for a commit
export async function fetchCombinedStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<{ state: string; statuses: any[] }> {
  const response = await octokit.repos.getCombinedStatusForRef({
    owner,
    repo,
    ref,
  });

  return {
    state: response.data.state,
    statuses: response.data.statuses,
  };
}

// Fetch review comments (inline)
export async function fetchReviewComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<ReviewComment[]> {
  const response = await octokit.pulls.listReviewComments({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  return response.data as ReviewComment[];
}

// Fetch issue comments (top-level)
export async function fetchIssueComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<IssueComment[]> {
  const response = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  return response.data as IssueComment[];
}

// Fetch reviews
export async function fetchReviews(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<any[]> {
  const response = await octokit.pulls.listReviews({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  return response.data;
}

// Post a top-level comment
export async function postComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

// Submit a review
export async function submitReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
  body?: string
): Promise<void> {
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event,
    body,
  });
}

// Create an inline review comment
export async function createReviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  commitId: string,
  path: string,
  line: number,
  side: 'LEFT' | 'RIGHT' = 'RIGHT'
): Promise<void> {
  await octokit.pulls.createReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    body,
    commit_id: commitId,
    path,
    line,
    side,
  });
}

// Reply to a review comment
export async function replyToReviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string
): Promise<void> {
  await octokit.pulls.createReplyForReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    comment_id: commentId,
    body,
  });
}

// Fetch commits in a PR
export async function fetchPRCommits(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Array<{
  sha: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
  };
  author: { login: string; avatar_url: string } | null;
  html_url: string;
}>> {
  const response = await octokit.pulls.listCommits({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 250,
  });

  return response.data.map(c => ({
    sha: c.sha,
    commit: {
      message: c.commit.message,
      author: c.commit.author,
    },
    author: c.author ? { login: c.author.login, avatar_url: c.author.avatar_url } : null,
    html_url: c.html_url,
  }));
}

// Fetch a single commit
export async function fetchCommit(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string
): Promise<{
  sha: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
  };
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>;
}> {
  const response = await octokit.repos.getCommit({
    owner,
    repo,
    ref: sha,
  });

  return {
    sha: response.data.sha,
    commit: {
      message: response.data.commit.message,
      author: response.data.commit.author,
    },
    files: (response.data.files || []).map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    })),
  };
}

// Compare two commits
export async function compareCommits(
  octokit: Octokit,
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<{
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  files: PRFile[];
  commits: Array<{
    sha: string;
    commit: { message: string; author: { name?: string; date?: string } | null };
    author: { login: string; avatar_url: string } | null;
  }>;
}> {
  const response = await octokit.repos.compareCommits({
    owner,
    repo,
    base,
    head,
  });

  return {
    ahead_by: response.data.ahead_by,
    behind_by: response.data.behind_by,
    total_commits: response.data.total_commits,
    files: (response.data.files || []) as PRFile[],
    commits: response.data.commits.map(c => ({
      sha: c.sha,
      commit: {
        message: c.commit.message,
        author: c.commit.author,
      },
      author: c.author ? { login: c.author.login, avatar_url: c.author.avatar_url } : null,
    })),
  };
}

// Get head SHA only (lightweight)
export async function fetchHeadSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<{ headSha: string; updatedAt: string }> {
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  return {
    headSha: response.data.head.sha,
    updatedAt: response.data.updated_at,
  };
}

// Fetch PR timeline events (force pushes, etc.)
export async function fetchPRTimeline(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Array<{
  event: string;
  created_at: string;
  sha?: string;
  commit_id?: string;
  from_commit_id?: string;
}>> {
  try {
    const response = await octokit.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/timeline',
      {
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
        headers: {
          accept: 'application/vnd.github.mockingbird-preview+json',
        },
      }
    );

    return response.data as Array<{
      event: string;
      created_at: string;
      sha?: string;
      commit_id?: string;
      from_commit_id?: string;
    }>;
  } catch (err) {
    console.error('Failed to fetch PR timeline:', err);
    return [];
  }
}

// Merge a pull request
export async function mergePR(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  commitTitle?: string,
  commitMessage?: string,
  mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge'
): Promise<{ merged: boolean; message: string; sha?: string }> {
  try {
    const response = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      commit_title: commitTitle,
      commit_message: commitMessage,
      merge_method: mergeMethod,
    });

    return {
      merged: response.data.merged,
      message: response.data.message,
      sha: response.data.sha,
    };
  } catch (err: any) {
    console.error('Failed to merge PR:', err);
    return {
      merged: false,
      message: err.message || 'Failed to merge PR',
    };
  }
}
