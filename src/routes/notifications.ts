import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { createUserOctokit, fetchReviewRequests, ReviewRequestItem } from '../lib/github.js';
import { query } from '../db/index.js';

const PAGE_SIZE = 20;

export async function notificationRoutes(fastify: FastifyInstance) {
  // Notifications page
  fastify.get(
    '/notifications',
    async (
      request: FastifyRequest<{
        Querystring: { filter?: string; repo?: string; page?: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      try {
        const octokit = createUserOctokit(request.user!.accessToken);
        const allItems = await fetchReviewRequests(octokit, request.user!.login);

        const userId = request.user!.githubUserId;
        const { rows: dismissals } = query<{ pr_key: string }>(
          `SELECT pr_key FROM notification_dismissals WHERE user_id = ?`,
          [userId]
        );
        const dismissedSet = new Set(dismissals.map((d) => d.pr_key));

        // Apply repo filter
        const repoFilter = request.query.repo || '';
        let filtered = allItems;
        if (repoFilter) {
          filtered = filtered.filter((item) => item.fullName === repoFilter);
        }

        // Split into pending and dismissed
        const pending = filtered.filter((item) => !dismissedSet.has(`${item.fullName}#${item.number}`));
        const dismissed = filtered.filter((item) => dismissedSet.has(`${item.fullName}#${item.number}`));

        // Apply unread filter
        const filterMode = request.query.filter || '';
        const showDismissed = filterMode !== 'unread';

        // Combine items for pagination
        const displayItems = showDismissed ? [...pending, ...dismissed] : pending;
        const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1);
        const totalPages = Math.max(1, Math.ceil(displayItems.length / PAGE_SIZE));
        const currentPage = Math.min(page, totalPages);
        const start = (currentPage - 1) * PAGE_SIZE;
        const pageItems = displayItems.slice(start, start + PAGE_SIZE);

        // Split page items back into pending/dismissed for display
        const pagePending = pageItems.filter((item) => !dismissedSet.has(`${item.fullName}#${item.number}`));
        const pageDismissed = pageItems.filter((item) => dismissedSet.has(`${item.fullName}#${item.number}`));

        // Get distinct repos for filter dropdown
        const repos = [...new Set(allItems.map((item) => item.fullName))].sort();

        return reply.view('notifications', {
          title: 'Review Requests - Argus',
          user: request.user,
          pending: pagePending,
          dismissed: pageDismissed,
          pendingCount: pending.length,
          totalCount: allItems.length,
          repos,
          repoFilter,
          filterMode,
          showDismissed,
          currentPage,
          totalPages,
        });
      } catch (err: any) {
        console.error('Error fetching review requests:', err);
        return reply.view('error', {
          title: 'Error - Argus',
          user: request.user,
          message: `Failed to fetch review requests: ${err.message}`,
        });
      }
    }
  );

  // JSON endpoint for badge count
  fastify.get('/api/notifications/count', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.send({ count: 0 });
    }

    try {
      const octokit = createUserOctokit(request.user.accessToken);
      const items = await fetchReviewRequests(octokit, request.user.login);

      const userId = request.user.githubUserId;
      const { rows: dismissals } = query<{ pr_key: string }>(
        `SELECT pr_key FROM notification_dismissals WHERE user_id = ?`,
        [userId]
      );
      const dismissedSet = new Set(dismissals.map((d) => d.pr_key));

      const count = items.filter(
        (item) => !dismissedSet.has(`${item.fullName}#${item.number}`)
      ).length;

      return reply.send({ count });
    } catch {
      return reply.send({ count: 0 });
    }
  });

  // Dismiss a single notification
  fastify.post(
    '/notifications/dismiss',
    async (
      request: FastifyRequest<{ Body: { prKey: string } }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { prKey } = request.body;
      if (!prKey) {
        return reply.status(400).send({ error: 'prKey is required' });
      }

      const userId = request.user!.githubUserId;
      query(
        `INSERT INTO notification_dismissals (user_id, pr_key)
         VALUES (?, ?)
         ON CONFLICT (user_id, pr_key) DO NOTHING`,
        [userId, prKey]
      );

      return reply.redirect('/notifications');
    }
  );

  // Dismiss all pending notifications
  fastify.post(
    '/notifications/dismiss-all',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireAuth(request, reply)) return;

      try {
        const octokit = createUserOctokit(request.user!.accessToken);
        const items = await fetchReviewRequests(octokit, request.user!.login);
        const userId = request.user!.githubUserId;

        const { rows: dismissals } = query<{ pr_key: string }>(
          `SELECT pr_key FROM notification_dismissals WHERE user_id = ?`,
          [userId]
        );
        const dismissedSet = new Set(dismissals.map((d) => d.pr_key));

        for (const item of items) {
          const prKey = `${item.fullName}#${item.number}`;
          if (!dismissedSet.has(prKey)) {
            query(
              `INSERT INTO notification_dismissals (user_id, pr_key)
               VALUES (?, ?)
               ON CONFLICT (user_id, pr_key) DO NOTHING`,
              [userId, prKey]
            );
          }
        }
      } catch (err) {
        console.error('Error dismissing all notifications:', err);
      }

      return reply.redirect('/notifications');
    }
  );

  // Undismiss a notification
  fastify.post(
    '/notifications/undismiss',
    async (
      request: FastifyRequest<{ Body: { prKey: string } }>,
      reply: FastifyReply
    ) => {
      if (!requireAuth(request, reply)) return;

      const { prKey } = request.body;
      if (!prKey) {
        return reply.status(400).send({ error: 'prKey is required' });
      }

      const userId = request.user!.githubUserId;
      query(
        `DELETE FROM notification_dismissals WHERE user_id = ? AND pr_key = ?`,
        [userId, prKey]
      );

      return reply.redirect('/notifications');
    }
  );
}
