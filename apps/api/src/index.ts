import 'dotenv/config';
import { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';

try {
  const config = loadConfig();
  const app = createApp(config, { log: (entry) => console.warn(JSON.stringify(entry)) });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => {
    console.info(`Vclarity backend listening on http://127.0.0.1:${info.port}`);
    if (!config.apiKey) console.info('AI_API_KEY is not set. AI requests will return a configuration error.');
  });
  // Bound incomplete uploads and header stalls in addition to the application deadline.
  if (server instanceof Server) {
    server.requestTimeout = 60_000;
    server.headersTimeout = 15_000;
    server.keepAliveTimeout = 5000;
  }
  server.on('error', () => {
    console.error('The backend could not listen. Check API_PORT and whether another process uses it.');
    process.exitCode = 1;
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(() => process.exit(0));
    setTimeout(() => { if (server instanceof Server) server.closeAllConnections(); process.exit(0); }, 5000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  // Configuration errors are deliberately value-free; never print an arbitrary stack.
  console.error(error instanceof Error ? error.message : 'The backend configuration is invalid.');
  process.exitCode = 1;
}
