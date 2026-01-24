import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import {
  createUserOctokit,
  fetchPR,
  fetchPRFiles,
  fetchChecks,
  fetchCombinedStatus,
  fetchReviewComments,
  fetchIssueComments,
  fetchReviews,
  fetchHeadSha,
  fetchPRCommits,
  fetchCommit,
  compareCommits,
  postComment,
  submitReview,
  createReviewComment,
  replyToReviewComment,
  fetchPRTimeline,
  mergePR,
} from '../lib/github.js';
import { query } from '../db/index.js';
import { parsePatch, truncateFile, DiffFile, parseHunkString } from '../lib/diff-parser.js';
import { renderFile, renderFileSidebarItem, renderInlineCommentForm, renderSimpleHunk } from '../lib/diff-renderer.js';
import { renderMarkdown } from '../lib/markdown.js';
import { config } from '../config.js';
import { computeMergeBase, computeRangeDiff } from '../lib/git.js';

interface PRParams {
  owner: string;
  repo: string;
  number: string;
}

export async function prRoutes(fastify: FastifyInstance) {
  // Main PR view
  fastify.get(
    '/pr/:owner/:repo/:number',
    async (
      request: FastifyRequest<{ Params: PRParams }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number } = request.params;
      const prNumber = parseInt(number, 10);

      if (isNaN(prNumber)) {
        return reply.status(400).view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: 'Invalid PR number',
        });
      }

      try {
        const octokit = createUserOctokit(request.user!.accessToken);

        // Fetch PR data in parallel
        const [pr, files, issueComments, reviewComments, reviews, commits] = await Promise.all([
          fetchPR(octokit, owner, repo, prNumber),
          fetchPRFiles(octokit, owner, repo, prNumber),
          fetchIssueComments(octokit, owner, repo, prNumber),
          fetchReviewComments(octokit, owner, repo, prNumber),
          fetchReviews(octokit, owner, repo, prNumber),
          fetchPRCommits(octokit, owner, repo, prNumber),
        ]);

        // Fetch checks (might fail if no checks)
        let checks: any[] = [];
        let combinedStatus = { state: 'unknown', statuses: [] as any[] };
        try {
          [checks, combinedStatus] = await Promise.all([
            fetchChecks(octokit, owner, repo, pr.head.sha),
            fetchCombinedStatus(octokit, owner, repo, pr.head.sha),
          ]);
        } catch (err) {
          // Checks might not exist, that's ok
        }

        // Group review comments by file path with rendered markdown
        type CommentWithRenderedBody = (typeof reviewComments)[0] & { renderedBody: string };
        const commentsByFile = new Map<string, CommentWithRenderedBody[]>();
        for (const comment of reviewComments) {
          const path = comment.path;
          if (!commentsByFile.has(path)) {
            commentsByFile.set(path, []);
          }
          commentsByFile.get(path)!.push({
            ...comment,
            renderedBody: renderMarkdown(comment.body),
          });
        }

        // Parse and render diffs
        const parsedFiles: Array<{
          file: DiffFile;
          path: string;
          renderedHtml: string;
          sidebarHtml: string;
          truncated: boolean;
          totalLines: number;
          comments: CommentWithRenderedBody[];
          commentCount: number;
        }> = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const fileComments = commentsByFile.get(file.filename) || [];

          if (!file.patch) {
            // Binary file or no changes
            const diffFile: DiffFile = {
              oldPath: file.filename,
              newPath: file.filename,
              status: file.status as any,
              hunks: [],
              additions: file.additions,
              deletions: file.deletions,
              isBinary: true,
            };

            parsedFiles.push({
              file: diffFile,
              path: file.filename,
              renderedHtml: renderFile(diffFile, i, pr.head.sha, false, 0, owner, repo, prNumber),
              sidebarHtml: renderFileSidebarItem(diffFile, i),
              truncated: false,
              totalLines: 0,
              comments: fileComments,
              commentCount: fileComments.length,
            });
            continue;
          }

          const parsedFile = parsePatch(file.patch, file.filename, file.status);
          const { truncatedFile, wasTruncated, totalLines } = truncateFile(
            parsedFile,
            config.ui.maxLinesPerFile
          );

          parsedFiles.push({
            file: parsedFile,
            path: file.filename,
            renderedHtml: renderFile(
              truncatedFile,
              i,
              pr.head.sha,
              wasTruncated,
              totalLines,
              owner,
              repo,
              prNumber
            ),
            sidebarHtml: renderFileSidebarItem(parsedFile, i),
            truncated: wasTruncated,
            totalLines,
            comments: fileComments,
            commentCount: fileComments.length,
          });
        }

        // Summarize checks
        const checksSummary = summarizeChecks(checks, combinedStatus);

        // Render PR body as markdown
        const renderedBody = renderMarkdown(pr.body);

        // Get current timestamp
        const fetchedAt = new Date().toISOString();

        // Backfill all historical revisions from GitHub timeline
        await backfillRevisions(
          owner,
          repo,
          prNumber,
          pr.base.ref,
          pr.base.sha,
          pr.head.ref,
          pr.head.sha,
          request.user!.accessToken,
          octokit
        );

        // Get all seen revisions
        const revisions = getRevisions(owner, repo, prNumber);

        return reply.view('pr', {
          title: `#${prNumber} ${pr.title} - Argus`,
          user: request.user,
          owner,
          repo,
          pr: {
            ...pr,
            renderedBody,
          },
          files: parsedFiles,
          issueComments: issueComments.map((c) => ({
            ...c,
            renderedBody: renderMarkdown(c.body),
          })),
          reviewComments: reviewComments.map((c) => ({
            ...c,
            renderedBody: renderMarkdown(c.body || ''),
            renderedHunk: c.diff_hunk ? renderSimpleHunk(parseHunkString(c.diff_hunk)) : '',
          })),
          reviews: reviews.map((r) => ({
            ...r,
            renderedBody: renderMarkdown(r.body),
          })),
          checksSummary,
          checks,
          statuses: combinedStatus.statuses,
          revisions,
          commits,
          fetchedAt,
          inlineCommentFormTemplate: renderInlineCommentForm(),
          pollIntervalMs: config.ui.pollIntervalMs,
        });
      } catch (err: any) {
        console.error('Error fetching PR:', err);

        if (err.status === 401) {
          return reply.status(401).view('error', {
            title: 'Authentication Error - Argus',
            user: request.user,
            message: 'GitHub token is invalid or expired. Please check your GITHUB_TOKEN environment variable.',
          });
        }

        if (err.status === 404) {
          return reply.status(404).view('error', {
            title: 'Not Found - Argus',
            user: request.user,
            message: `Pull request ${owner}/${repo}#${prNumber} not found`,
          });
        }

        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to load pull request: ${err.message}`,
        });
      }
    }
  );

  // Polling endpoint for head SHA
  fastify.get(
    '/pr/:owner/:repo/:number/head',
    async (
      request: FastifyRequest<{ Params: PRParams }>,
      reply: FastifyReply
    ) => {
      if (!request.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { owner, repo, number } = request.params;
      const prNumber = parseInt(number, 10);

      if (isNaN(prNumber)) {
        return reply.status(400).send({ error: 'Invalid PR number' });
      }

      try {
        const octokit = createUserOctokit(request.user.accessToken);
        const { headSha, updatedAt } = await fetchHeadSha(octokit, owner, repo, prNumber);

        return reply.send({
          head_sha: headSha,
          updated_at: updatedAt,
        });
      } catch (err: any) {
        console.error('Error fetching head SHA:', err);
        return reply.status(500).send({ error: 'Failed to fetch head SHA' });
      }
    }
  );

  // Load full file diff
  fastify.get(
    '/pr/:owner/:repo/:number/file',
    async (
      request: FastifyRequest<{
        Params: PRParams;
        Querystring: { path: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number } = request.params;
      const { path } = request.query;
      const prNumber = parseInt(number, 10);

      if (!path) {
        return reply.status(400).send('Missing path parameter');
      }

      try {
        const octokit = createUserOctokit(request.user!.accessToken);

        // Fetch PR to get head SHA
        const pr = await fetchPR(octokit, owner, repo, prNumber);

        // Fetch files to get the specific file's patch
        const files = await fetchPRFiles(octokit, owner, repo, prNumber);
        const file = files.find((f) => f.filename === path);

        if (!file) {
          return reply.status(404).send('File not found');
        }

        if (!file.patch) {
          return reply.send('<div class="diff-binary-notice">Binary file</div>');
        }

        const parsedFile = parsePatch(file.patch, file.filename, file.status);

        // Find the file index for data attributes
        const fileIndex = files.findIndex((f) => f.filename === path);

        const html = renderFile(
          parsedFile,
          fileIndex,
          pr.head.sha,
          false,
          0,
          owner,
          repo,
          prNumber
        );

        // Return just the diff content (without the outer wrapper since we're replacing)
        return reply.type('text/html').send(html);
      } catch (err: any) {
        console.error('Error loading file diff:', err);
        return reply.status(500).send('Failed to load file diff');
      }
    }
  );

  // Post top-level comment
  fastify.post(
    '/pr/:owner/:repo/:number/comment',
    async (
      request: FastifyRequest<{
        Params: PRParams;
        Body: { body: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number } = request.params;
      const { body } = request.body;
      const prNumber = parseInt(number, 10);

      if (!body || !body.trim()) {
        return reply.status(400).view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: 'Comment body is required',
        });
      }

      try {
        const octokit = createUserOctokit(request.user!.accessToken);
        await postComment(octokit, owner, repo, prNumber, body.trim());

        return reply.redirect(`/pr/${owner}/${repo}/${number}`);
      } catch (err: any) {
        console.error('Error posting comment:', err);
        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to post comment: ${err.message}`,
        });
      }
    }
  );

  // Submit review
  fastify.post(
    '/pr/:owner/:repo/:number/review',
    async (
      request: FastifyRequest<{
        Params: PRParams;
        Body: { event: string; body?: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number } = request.params;
      const { event, body } = request.body;
      const prNumber = parseInt(number, 10);

      const validEvents = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];
      if (!event || !validEvents.includes(event)) {
        return reply.status(400).view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: 'Invalid review event',
        });
      }

      // REQUEST_CHANGES requires a body
      if (event === 'REQUEST_CHANGES' && (!body || !body.trim())) {
        return reply.status(400).view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: 'Body is required for request changes',
        });
      }

      try {
        const octokit = createUserOctokit(request.user!.accessToken);
        await submitReview(
          octokit,
          owner,
          repo,
          prNumber,
          event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
          body?.trim()
        );

        return reply.redirect(`/pr/${owner}/${repo}/${number}`);
      } catch (err: any) {
        console.error('Error submitting review:', err);
        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to submit review: ${err.message}`,
        });
      }
    }
  );

  // Create inline comment
  fastify.post(
    '/pr/:owner/:repo/:number/inline-comment',
    async (
      request: FastifyRequest<{
        Params: PRParams;
        Body: {
          body: string;
          path: string;
          line: string;
          side: string;
          commit_id: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number } = request.params;
      const { body, path, line, side, commit_id } = request.body;
      const prNumber = parseInt(number, 10);
      const lineNum = parseInt(line, 10);

      if (!body?.trim() || !path || isNaN(lineNum) || !commit_id) {
        return reply.status(400).view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: 'Missing required fields for inline comment',
        });
      }

      try {
        const octokit = createUserOctokit(request.user!.accessToken);
        await createReviewComment(
          octokit,
          owner,
          repo,
          prNumber,
          body.trim(),
          commit_id,
          path,
          lineNum,
          (side as 'LEFT' | 'RIGHT') || 'RIGHT'
        );

        return reply.redirect(`/pr/${owner}/${repo}/${number}`);
      } catch (err: any) {
        console.error('Error creating inline comment:', err);
        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to create inline comment: ${err.message}`,
        });
      }
    }
  );

  // Reply to a comment thread
  fastify.post(
    '/pr/:owner/:repo/:number/reply',
    async (
      request: FastifyRequest<{
        Params: PRParams;
        Body: { comment_id: string; body: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number } = request.params;
      const { comment_id, body } = request.body;
      const prNumber = parseInt(number, 10);
      const commentId = parseInt(comment_id, 10);

      if (!body?.trim() || isNaN(commentId)) {
        return reply.status(400).view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: 'Missing required fields for reply',
        });
      }

      try {
        const octokit = createUserOctokit(request.user!.accessToken);
        await replyToReviewComment(
          octokit,
          owner,
          repo,
          prNumber,
          commentId,
          body.trim()
        );

        return reply.redirect(`/pr/${owner}/${repo}/${number}`);
      } catch (err: any) {
        console.error('Error replying to comment:', err);
        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to reply: ${err.message}`,
        });
      }
    }
  );

  // Commits list
  fastify.get(
    '/pr/:owner/:repo/:number/commits',
    async (
      request: FastifyRequest<{ Params: PRParams }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number } = request.params;
      const prNumber = parseInt(number, 10);

      try {
        const octokit = createUserOctokit(request.user!.accessToken);
        const [pr, commits] = await Promise.all([
          fetchPR(octokit, owner, repo, prNumber),
          fetchPRCommits(octokit, owner, repo, prNumber),
        ]);

        // Backfill all historical revisions from GitHub timeline
        await backfillRevisions(
          owner,
          repo,
          prNumber,
          pr.base.ref,
          pr.base.sha,
          pr.head.ref,
          pr.head.sha,
          request.user!.accessToken,
          octokit
        );

        const revisions = getRevisions(owner, repo, prNumber);

        return reply.view('commits', {
          title: `Commits - #${prNumber} - Argus`,
          user: request.user,
          owner,
          repo,
          prNumber,
          pr,
          commits,
          revisions,
        });
      } catch (err: any) {
        console.error('Error fetching commits:', err);
        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to load commits: ${err.message}`,
        });
      }
    }
  );

  // Compare two commits
  fastify.get(
    '/pr/:owner/:repo/:number/compare/:base/:head',
    async (
      request: FastifyRequest<{
        Params: PRParams & { base: string; head: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number, base, head } = request.params;
      const prNumber = parseInt(number, 10);

      try {
        const octokit = createUserOctokit(request.user!.accessToken);
        const comparison = await compareCommits(octokit, owner, repo, base, head);

        // Parse and render diffs
        const parsedFiles = comparison.files.map((file, i) => {
          if (!file.patch) {
            return {
              path: file.filename,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              patch: null,
            };
          }
          return {
            path: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            patch: file.patch,
          };
        });

        return reply.view('compare', {
          title: `${base.slice(0, 7)}..${head.slice(0, 7)} - Argus`,
          user: request.user,
          owner,
          repo,
          prNumber,
          base,
          head,
          comparison,
          files: parsedFiles,
        });
      } catch (err: any) {
        console.error('Error comparing commits:', err);
        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to compare: ${err.message}`,
        });
      }
    }
  );

  // Range-diff between two revisions
  fastify.get(
    '/pr/:owner/:repo/:number/range-diff/:fromId/:toId',
    async (
      request: FastifyRequest<{
        Params: PRParams & { fromId: string; toId: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number, fromId, toId } = request.params;
      const prNumber = parseInt(number, 10);
      const fromRevId = parseInt(fromId, 10);
      const toRevId = parseInt(toId, 10);

      if (isNaN(prNumber) || isNaN(fromRevId) || isNaN(toRevId)) {
        return reply.status(400).view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: 'Invalid parameters',
        });
      }

      try {
        // Load both revisions from DB
        const { rows: fromRows } = query<{
          id: number;
          head_sha: string;
          head_ref: string;
          base_sha: string;
          base_ref: string;
          merge_base_sha: string | null;
          seen_at: string;
        }>(
          `SELECT id, head_sha, head_ref, base_sha, base_ref, merge_base_sha, seen_at
           FROM pr_revisions WHERE id = ?`,
          [fromRevId]
        );

        const { rows: toRows } = query<{
          id: number;
          head_sha: string;
          head_ref: string;
          base_sha: string;
          base_ref: string;
          merge_base_sha: string | null;
          seen_at: string;
        }>(
          `SELECT id, head_sha, head_ref, base_sha, base_ref, merge_base_sha, seen_at
           FROM pr_revisions WHERE id = ?`,
          [toRevId]
        );

        if (fromRows.length === 0 || toRows.length === 0) {
          return reply.status(404).view('error', {
            title: 'Error - Argus',
            user: request.user,
            message: 'Revision not found',
          });
        }

        const fromRev = fromRows[0];
        const toRev = toRows[0];

        // Check if we need to compute merge-base (requires git clone)
        const needsCompute = !fromRev.merge_base_sha || !toRev.merge_base_sha;

        // Check if user has enabled "don't ask again" preference for this repo
        const prefKey = `range_diff_skip_confirm:${owner}/${repo}`;
        const { rows: prefRows } = query<{ preference_value: string }>(
          `SELECT preference_value FROM user_preferences WHERE user_id = ? AND preference_key = ?`,
          [request.user!.githubUserId, prefKey]
        );
        const skipConfirm = prefRows.length > 0 && prefRows[0].preference_value === '1';

        // If merge-base not computed and user hasn't skipped confirmation, show warning page
        if (needsCompute && !skipConfirm) {
          return reply.view('range-diff-confirm', {
            title: `Range-diff - #${prNumber} - Argus`,
            user: request.user,
            owner,
            repo,
            prNumber,
            fromRev,
            toRev,
          });
        }

        // Compute merge-base on-demand if missing
        let fromMergeBase = fromRev.merge_base_sha;
        let toMergeBase = toRev.merge_base_sha;

        if (!fromMergeBase) {
          console.log(`Computing merge-base for revision ${fromRev.id} (${fromRev.head_sha.slice(0, 7)})...`);
          fromMergeBase = await computeMergeBase(
            owner,
            repo,
            fromRev.base_sha,
            fromRev.head_sha,
            request.user!.accessToken
          );
          // Update DB with computed merge-base
          query(
            `UPDATE pr_revisions SET merge_base_sha = ? WHERE id = ?`,
            [fromMergeBase, fromRevId]
          );
        }

        if (!toMergeBase) {
          console.log(`Computing merge-base for revision ${toRev.id} (${toRev.head_sha.slice(0, 7)})...`);
          toMergeBase = await computeMergeBase(
            owner,
            repo,
            toRev.base_sha,
            toRev.head_sha,
            request.user!.accessToken
          );
          // Update DB with computed merge-base
          query(
            `UPDATE pr_revisions SET merge_base_sha = ? WHERE id = ?`,
            [toMergeBase, toRevId]
          );
        }

        // Compute range-diff
        const rangeDiff = await computeRangeDiff(
          owner,
          repo,
          fromMergeBase,
          fromRev.head_sha,
          toMergeBase,
          toRev.head_sha,
          request.user!.accessToken
        );

        return reply.view('range-diff', {
          title: `Range-diff - #${prNumber} - Argus`,
          user: request.user,
          owner,
          repo,
          prNumber,
          fromRev: { ...fromRev, merge_base_sha: fromMergeBase },
          toRev: { ...toRev, merge_base_sha: toMergeBase },
          rangeDiff,
        });
      } catch (err: any) {
        console.error('Error computing range-diff:', err);
        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to compute range-diff: ${err.message}`,
        });
      }
    }
  );

  // Get commit diff
  fastify.get(
    '/pr/:owner/:repo/:number/commit/:sha',
    async (
      request: FastifyRequest<{
        Params: PRParams & { sha: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, sha } = request.params;

      try {
        const octokit = createUserOctokit(request.user!.accessToken);
        const commit = await fetchCommit(octokit, owner, repo, sha);

        // Parse and render each file's diff
        const parsedFiles: Array<{
          file: DiffFile;
          path: string;
          renderedHtml: string;
        }> = [];

        for (let i = 0; i < commit.files.length; i++) {
          const file = commit.files[i];

          if (!file.patch) {
            // Binary file or no changes
            const diffFile: DiffFile = {
              oldPath: file.filename,
              newPath: file.filename,
              status: file.status as any,
              hunks: [],
              additions: file.additions,
              deletions: file.deletions,
              isBinary: true,
            };

            parsedFiles.push({
              file: diffFile,
              path: file.filename,
              renderedHtml: renderFile(diffFile, i, sha, false, 0, owner, repo, 0),
            });
            continue;
          }

          const parsedFile = parsePatch(file.patch, file.filename, file.status);

          parsedFiles.push({
            file: parsedFile,
            path: file.filename,
            renderedHtml: renderFile(parsedFile, i, sha, false, 0, owner, repo, 0),
          });
        }

        return reply.view('commit', {
          title: `Commit ${sha.slice(0, 7)} - Argus`,
          user: request.user,
          owner,
          repo,
          commit,
          files: parsedFiles,
        });
      } catch (err: any) {
        console.error('Error fetching commit:', err);
        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to fetch commit: ${err.message}`,
        });
      }
    }
  );

  // Handle range-diff confirmation form
  fastify.post(
    '/pr/:owner/:repo/:number/range-diff/:fromId/:toId/confirm',
    async (
      request: FastifyRequest<{
        Params: PRParams & { fromId: string; toId: string };
        Body: { dont_ask_again?: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number, fromId, toId } = request.params;
      const prNumber = parseInt(number, 10);

      // Save preference if checkbox was checked
      if (request.body?.dont_ask_again === '1') {
        const prefKey = `range_diff_skip_confirm:${owner}/${repo}`;
        query(
          `INSERT OR REPLACE INTO user_preferences (user_id, preference_key, preference_value, updated_at)
           VALUES (?, ?, '1', datetime('now'))`,
          [request.user!.githubUserId, prefKey]
        );
      }

      // Redirect to the range-diff route which will now compute
      return reply.redirect(
        `/pr/${owner}/${repo}/${prNumber}/range-diff/${fromId}/${toId}`
      );
    }
  );

  // Merge PR
  fastify.post(
    '/pr/:owner/:repo/:number/merge',
    async (
      request: FastifyRequest<{
        Params: PRParams;
        Body: {
          merge_method?: 'merge' | 'squash' | 'rebase';
          commit_title?: string;
          commit_message?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { owner, repo, number } = request.params;
      const { merge_method = 'merge', commit_title, commit_message } = request.body;
      const prNumber = parseInt(number, 10);

      try {
        const octokit = createUserOctokit(request.user!.accessToken);
        const result = await mergePR(
          octokit,
          owner,
          repo,
          prNumber,
          commit_title,
          commit_message,
          merge_method
        );

        if (!result.merged) {
          return reply.view('error', {
            title: 'Merge Failed - Argus',
            user: request.user,
            message: `Failed to merge PR: ${result.message}`,
          });
        }

        return reply.redirect(`/pr/${owner}/${repo}/${number}`);
      } catch (err: any) {
        console.error('Error merging PR:', err);
        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to merge PR: ${err.message}`,
        });
      }
    }
  );
}

// Helper to summarize checks status
function summarizeChecks(
  checks: any[],
  combinedStatus: { state: string; statuses: any[] }
): {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  state: string;
} {
  let passed = 0;
  let failed = 0;
  let pending = 0;

  // Count check runs
  for (const check of checks) {
    if (check.status === 'completed') {
      if (check.conclusion === 'success' || check.conclusion === 'skipped') {
        passed++;
      } else if (
        check.conclusion === 'failure' ||
        check.conclusion === 'cancelled' ||
        check.conclusion === 'timed_out'
      ) {
        failed++;
      } else {
        pending++;
      }
    } else {
      pending++;
    }
  }

  // Count statuses
  for (const status of combinedStatus.statuses) {
    if (status.state === 'success') {
      passed++;
    } else if (status.state === 'failure' || status.state === 'error') {
      failed++;
    } else {
      pending++;
    }
  }

  const total = passed + failed + pending;

  let state = 'success';
  if (failed > 0) {
    state = 'failure';
  } else if (pending > 0) {
    state = 'pending';
  }

  return { total, passed, failed, pending, state };
}

// Save PR revision for force push tracking
async function saveRevision(
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  headRef: string,
  baseSha: string,
  baseRef: string,
  accessToken: string,
  seenAt?: string
): Promise<void> {
  try {
    // Don't compute merge-base eagerly - do it lazily when range-diff is requested for speed
    const mergeBaseSha: string | null = null;

    if (seenAt) {
      // Insert with specific timestamp (for historical backfill)
      query(
        `INSERT OR IGNORE INTO pr_revisions (owner, repo, pr_number, head_sha, head_ref, base_sha, base_ref, merge_base_sha, seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [owner, repo, prNumber, headSha, headRef, baseSha, baseRef, mergeBaseSha, seenAt]
      );
    } else {
      // Insert with current timestamp
      query(
        `INSERT OR IGNORE INTO pr_revisions (owner, repo, pr_number, head_sha, head_ref, base_sha, base_ref, merge_base_sha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [owner, repo, prNumber, headSha, headRef, baseSha, baseRef, mergeBaseSha]
      );
    }
  } catch (err) {
    console.error('Failed to save revision:', err);
    // Ignore errors - revision tracking is optional
  }
}

// Backfill historical revisions from GitHub timeline
async function backfillRevisions(
  owner: string,
  repo: string,
  prNumber: number,
  baseRef: string,
  baseSha: string,
  headRef: string,
  currentHeadSha: string,
  accessToken: string,
  octokit: any
): Promise<void> {
  try {
    const timeline = await fetchPRTimeline(octokit, owner, repo, prNumber);

    // Extract force-push events and initial commit
    const revisions: Array<{ sha: string; timestamp: string }> = [];

    // Find the PR creation event to get the initial head SHA
    const createdEvent = timeline.find(e => e.event === 'committed' || e.event === 'head_ref_force_pushed');

    for (const event of timeline) {
      if (event.event === 'head_ref_force_pushed' && event.commit_id) {
        revisions.push({
          sha: event.commit_id,
          timestamp: event.created_at,
        });
      }
    }

    // Add current head if not already in the list
    if (!revisions.find(r => r.sha === currentHeadSha)) {
      revisions.push({
        sha: currentHeadSha,
        timestamp: new Date().toISOString(),
      });
    }

    // Sort by timestamp (oldest first)
    revisions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Save each revision
    for (const rev of revisions) {
      await saveRevision(
        owner,
        repo,
        prNumber,
        rev.sha,
        headRef,
        baseSha,
        baseRef,
        accessToken,
        rev.timestamp
      );
    }

    console.log(`Backfilled ${revisions.length} revisions for PR #${prNumber}`);
  } catch (err) {
    console.error('Failed to backfill revisions:', err);
    // Continue - backfill is optional
  }
}

// Get all revisions for a PR
function getRevisions(
  owner: string,
  repo: string,
  prNumber: number
): Array<{
  id: number;
  head_sha: string;
  head_ref: string;
  base_sha: string;
  base_ref: string;
  merge_base_sha: string | null;
  seen_at: string;
}> {
  const { rows } = query<{
    id: number;
    head_sha: string;
    head_ref: string;
    base_sha: string;
    base_ref: string;
    merge_base_sha: string | null;
    seen_at: string;
  }>(
    `SELECT id, head_sha, head_ref, base_sha, base_ref, merge_base_sha, seen_at FROM pr_revisions
     WHERE owner = ? AND repo = ? AND pr_number = ?
     ORDER BY seen_at DESC`,
    [owner, repo, prNumber]
  );
  return rows;
}
