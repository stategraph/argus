import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

export async function homeRoutes(fastify: FastifyInstance) {
  // Landing page - redirect to dashboard if authenticated
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user) {
      return reply.redirect('/dashboard');
    }

    // No user means token auth failed
    return reply.view('error', {
      title: 'Authentication Error - Argus',
      user: null,
      message: 'Invalid GITHUB_TOKEN. Please check your token and restart the server.',
    });
  });
}
