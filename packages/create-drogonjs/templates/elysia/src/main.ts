import 'reflect-metadata';
import { createElysiaApplication } from '@drogonjs/platform-elysia';
// #if openapi
import { drogonOpenAPI } from '@drogonjs/openapi';
// #endif
import { AppModule } from './modules/app/app.module';

const port = Number(process.env.PORT ?? 3000);

const { app, application } = await createElysiaApplication(AppModule);

// Runs onModuleDestroy / onApplicationShutdown hooks on SIGTERM and SIGINT.
application.enableShutdownHooks();

// #if openapi
app.use(
  drogonOpenAPI({
    path: '/openapi',
    documentation: {
      info: { title: '__PROJECT_NAME__', version: '0.1.0' }
    }
  })
);
// #endif

app.listen(port);

console.log(`__PROJECT_NAME__ listening on http://localhost:${port}`);
// #if openapi
console.log(`OpenAPI document at http://localhost:${port}/openapi`);
// #endif
