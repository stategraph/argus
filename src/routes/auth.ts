import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function authRoutes(fastify: FastifyInstance) {
  // Login redirects to dashboard (token auth is automatic)
  fastify.get('/login', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect('/dashboard');
  });

  // Logout redirects to home (token auth doesn't have sessions)
  fastify.get('/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect('/');
  });
}
