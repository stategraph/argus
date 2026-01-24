import Fastify from 'fastify';
import fastifyView from '@fastify/view';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import ejs from 'ejs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { initDb, closeDb } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { homeRoutes } from './routes/home.js';
import { prRoutes } from './routes/pr.js';
import { repoRoutes } from './routes/repos.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { authMiddleware, initTokenAuth } from './middleware/auth.js';

const isDev = process.env.NODE_ENV !== 'production';

const fastify = Fastify({
  logger: isDev
    ? {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
        },
      }
    : { level: 'info' }, // Plain JSON logging in production
});

async function start() {
  try {
    // Initialize database
    initDb(config.databasePath);

    // Initialize GitHub token authentication
    await initTokenAuth();

    // Register plugins
    await fastify.register(fastifyCookie);

    await fastify.register(fastifyFormbody);

    await fastify.register(fastifyView, {
      engine: { ejs },
      root: join(__dirname, 'templates'),
      viewExt: 'ejs',
      defaultContext: {
        baseUrl: config.baseUrl,
      },
    });

    await fastify.register(fastifyStatic, {
      root: join(__dirname, '..', 'public'),
      prefix: '/static/',
    });

    // Add auth context to all requests
    fastify.decorateRequest('user', null);
    fastify.addHook('preHandler', authMiddleware);

    // Register routes
    await fastify.register(homeRoutes);
    await fastify.register(authRoutes, { prefix: '/auth' });
    await fastify.register(repoRoutes);
    await fastify.register(prRoutes);
    await fastify.register(dashboardRoutes);

    // Start server
    await fastify.listen({ port: config.port, host: config.host });
    console.log(`Server running at http://${config.host}:${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await fastify.close();
    await closeDb();
    process.exit(0);
  });
});

start();
