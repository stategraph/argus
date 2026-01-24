import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { createUserOctokit } from '../lib/github.js';

export async function dashboardRoutes(fastify: FastifyInstance) {
  // Dashboard - show open PRs grouped by repo
  fastify.get('/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAuth(request, reply)) return;

    try {
      const octokit = createUserOctokit(request.user!.accessToken);

      // Fetch repos with recent activity
      const { data: repos } = await octokit.repos.listForAuthenticatedUser({
        sort: 'pushed',
        per_page: 30,
      });

      // Fetch open PRs for each repo (in parallel, limited)
      const reposWithPRs: Array<{
        owner: string;
        name: string;
        fullName: string;
        pulls: Array<{
          number: number;
          title: string;
          author: string;
          updatedAt: string;
          draft: boolean;
        }>;
      }> = [];

      // Fetch PRs for top repos (limit to avoid rate limits)
      const prPromises = repos.slice(0, 15).map(async (repo) => {
        try {
          const { data: pulls } = await octokit.pulls.list({
            owner: repo.owner?.login || '',
            repo: repo.name,
            state: 'open',
            sort: 'updated',
            direction: 'desc',
            per_page: 10,
          });

          if (pulls.length > 0) {
            return {
              owner: repo.owner?.login || '',
              name: repo.name,
              fullName: repo.full_name,
              pulls: pulls.map((pr) => ({
                number: pr.number,
                title: pr.title,
                author: pr.user?.login || 'unknown',
                updatedAt: pr.updated_at,
                draft: pr.draft || false,
              })),
            };
          }
          return null;
        } catch {
          return null;
        }
      });

      const results = await Promise.all(prPromises);
      for (const result of results) {
        if (result) {
          reposWithPRs.push(result);
        }
      }

      // Sort by most recently updated PR
      reposWithPRs.sort((a, b) => {
        const aDate = a.pulls[0]?.updatedAt || '';
        const bDate = b.pulls[0]?.updatedAt || '';
        return bDate.localeCompare(aDate);
      });

      // Count total PRs
      const totalPRs = reposWithPRs.reduce((sum, r) => sum + r.pulls.length, 0);

      return reply.view('dashboard', {
        title: 'Dashboard - Argus',
        user: request.user,
        reposWithPRs,
        totalPRs,
      });
    } catch (err: any) {
      console.error('Error fetching dashboard:', err);

      if (err.status === 401) {
        return reply.status(401).view('error', {
          title: 'Authentication Error - Argus',
          user: request.user,
          message: 'GitHub token is invalid or expired. Please check your GITHUB_TOKEN environment variable.',
        });
      }

      return reply.view('error', {
        title: 'Error - Argus',
        user: request.user,
        message: 'Failed to load dashboard',
      });
    }
  });
}
