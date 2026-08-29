/**
 * Issue references carried in commit messages.
 *
 * The convention this parses is the one GitHub itself renders in a commit message:
 * `#123` for an issue in the PR's own repository, and `owner/repo#123` for an issue in
 * another one. A PR's commits are therefore a statement of which issues the PR closes or
 * relates to, and the Issues tab is that statement resolved to real titles.
 *
 * Parsing is deliberately pure and offline: `parseIssueRefs` never touches the network,
 * so the shape of the convention is testable on its own, and `resolveIssueRefs` is the
 * only part that costs an API call.
 */

import { Octokit } from '@octokit/rest';
import { cachedFetch, TTL, type CacheMode } from './api-cache.js';

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
  /** Lower-cased `owner/repo#number`. GitHub names are case-insensitive, so this is what
   *  de-duplicates `Orbitz/Argus#7` against `orbitz/argus#7`. */
  key: string;
}

/**
 * Two shapes in one pattern, with the `owner/repo` half optional.
 *
 * The lookbehind is what keeps URLs out: in `https://github.com/orbitz/argus#3` the
 * qualified form is refused because `orbitz` follows a `/`, and the bare form is refused
 * because `#` follows a word character. `(?!\w)` after the digits rejects `#1abc`.
 *
 * Known and accepted limitation: a six-digit hex colour (`#123456`) parses as a reference.
 * Commit messages carrying one are rare, and the resolve step drops what does not exist.
 */
const ISSUE_REF_RE =
  /(?<![\w/#&])(?:([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+))?#(\d+)(?!\w)/g;

/**
 * Every issue reference in one block of text, in the order it appears, de-duplicated.
 *
 * @param text          Commit message (subject and body), or any free text.
 * @param defaultOwner  Owner an unqualified `#123` belongs to — the PR's own repository.
 * @param defaultRepo   Repository an unqualified `#123` belongs to.
 */
export function parseIssueRefs(
  text: string | null | undefined,
  defaultOwner: string,
  defaultRepo: string
): IssueRef[] {
  if (!text) return [];

  const found = new Map<string, IssueRef>();
  // Reset explicitly: the pattern is a module-level global regex, so lastIndex survives
  // between calls and would make the second call start mid-string.
  ISSUE_REF_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ISSUE_REF_RE.exec(text)) !== null) {
    const [, owner, repo, digits] = match;
    const number = parseInt(digits, 10);
    // Issue numbers start at 1, so `#0` is punctuation, not a reference.
    if (!Number.isSafeInteger(number) || number < 1) continue;

    const refOwner = owner || defaultOwner;
    const refRepo = repo || defaultRepo;
    const key = `${refOwner.toLowerCase()}/${refRepo.toLowerCase()}#${number}`;
    if (found.has(key)) continue;

    found.set(key, { owner: refOwner, repo: refRepo, number, key });
  }

  return [...found.values()];
}

/** The commit fields this module reads. Structurally satisfied by `PRCommit`. */
export interface CommitLike {
  sha: string;
  commit: { message: string };
}

/**
 * Every issue the PR's commits reference, in commit order then in-message order.
 *
 * The PR's own number is dropped: a commit that says `#42` on PR 42 is referring to the
 * page the reader is already on.
 */
export function collectCommitIssueRefs(
  commits: CommitLike[],
  owner: string,
  repo: string,
  prNumber: number
): IssueRef[] {
  const selfKey = `${owner.toLowerCase()}/${repo.toLowerCase()}#${prNumber}`;
  const found = new Map<string, IssueRef>();

  for (const commit of commits) {
    for (const ref of parseIssueRefs(commit.commit.message, owner, repo)) {
      if (ref.key === selfKey) continue;
      if (!found.has(ref.key)) found.set(ref.key, ref);
    }
  }

  return [...found.values()];
}

/** A reference resolved against the API. `title` is null when the lookup failed. */
export interface ResolvedIssue extends IssueRef {
  title: string | null;
  state: string | null;
  /** GitHub's own URL. Argus has no issue view, and the github.com proxy passes
   *  `/owner/repo/issues/N` straight through, so this link needs no `?argus=0`. */
  htmlUrl: string;
  /** True when the number turned out to be a pull request. `issues.get` serves both. */
  isPullRequest: boolean;
  /** Why the title is missing — shown in place of it rather than swallowed. */
  error: string | null;
}

const issueKey = (owner: string, repo: string, n: number) => `issue:${owner}/${repo}#${n}`;

interface IssueSummary {
  title: string;
  state: string;
  html_url: string;
  isPullRequest: boolean;
}

/** One issue, through the same ETag cache every other GitHub resource uses. */
export async function fetchIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  number: number,
  mode?: CacheMode
): Promise<IssueSummary> {
  const result = await cachedFetch<IssueSummary>(
    issueKey(owner, repo, number),
    { ttlMs: TTL.issue, mode },
    async (headers) => {
      const response = await octokit.issues.get({
        owner,
        repo,
        issue_number: number,
        headers,
      });
      return {
        data: {
          title: response.data.title,
          state: response.data.state,
          html_url: response.data.html_url,
          isPullRequest: Boolean(response.data.pull_request),
        },
        etag: response.headers.etag || null,
      };
    }
  );
  return result.data;
}

/**
 * Resolve references to titles, all in parallel.
 *
 * A reference that cannot be read — a deleted issue, a typo, a private repository the
 * token cannot see — resolves to a row with an error instead of failing the whole page.
 * The referenced repository is frequently not the PR's own, so a 404 is ordinary here.
 */
export async function resolveIssueRefs(
  octokit: Octokit,
  refs: IssueRef[],
  mode?: CacheMode
): Promise<ResolvedIssue[]> {
  return Promise.all(
    refs.map(async (ref): Promise<ResolvedIssue> => {
      const htmlUrl = `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`;
      try {
        const issue = await fetchIssue(octokit, ref.owner, ref.repo, ref.number, mode);
        return {
          ...ref,
          title: issue.title,
          state: issue.state,
          htmlUrl: issue.html_url || htmlUrl,
          isPullRequest: issue.isPullRequest,
          error: null,
        };
      } catch (err: any) {
        const status = err?.status;
        return {
          ...ref,
          title: null,
          state: null,
          htmlUrl,
          isPullRequest: false,
          error: status === 404 ? 'Not found, or not visible to this token' : 'Could not be loaded',
        };
      }
    })
  );
}
