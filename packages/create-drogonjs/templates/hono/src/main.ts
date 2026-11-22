import 'reflect-metadata';
import { createHonoApplication } from '@drogonjs/platform-hono';
import { AppModule } from './modules/app/app.module';

const port = Number(process.env.PORT ?? 3000);

const { app, application } = await createHonoApplication(AppModule);

// Runs onModuleDestroy / onApplicationShutdown hooks on SIGTERM and SIGINT.
application.enableShutdownHooks();

console.log(`__PROJECT_NAME__ listening on http://localhost:${port}`);

// Hono hands back a plain fetch handler, so Bun serves it from the default
// export. The same handler runs unchanged on Workers, Deno or Node.
export default {
  port,
  fetch: app.fetch
};
