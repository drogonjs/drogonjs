# DrogonJS

Bun-native, modular backend framework with the NestJS programming model —
modules, dependency injection, controllers, guards, pipes, interceptors,
filters and middleware — running on your choice of two HTTP adapters,
[Elysia](https://elysiajs.com) or [Hono](https://hono.dev). Ships with a
TypeORM-style data layer on [Drizzle ORM](https://orm.drizzle.team) and a
NestJS-style config module.

## Quick start

```bash
bun create drogonjs my-app
cd my-app
bun run dev
```

Or add it to an existing Bun project:

```bash
bun add @drogonjs/common @drogonjs/core @drogonjs/platform-hono hono reflect-metadata
```

```ts
// main.ts
import 'reflect-metadata';
import { Controller, Get, Injectable, Module, Param, ParseIntPipe } from '@drogonjs/common';
import { createHonoApplication } from '@drogonjs/platform-hono';

@Injectable()
class CatsService {
  find(id: number) {
    return { id, name: 'Tom' };
  }
}

@Controller('cats')
class CatsController {
  constructor(private readonly cats: CatsService) {}

  @Get(':id')
  find(@Param('id', ParseIntPipe) id: number) {
    return this.cats.find(id);
  }
}

@Module({ controllers: [CatsController], providers: [CatsService] })
class AppModule {}

const { app, application } = await createHonoApplication(AppModule, { globalPrefix: 'api' });
application.enableShutdownHooks();

export default { port: 3000, fetch: app.fetch };
```

Your `tsconfig.json` needs `"experimentalDecorators": true` and
`"emitDecoratorMetadata": true` — without them Bun silently skips the metadata
DI relies on.

## Packages

| Package | What it provides |
| --- | --- |
| `@drogonjs/common` | Decorators, metadata, `Reflector`, exceptions, built-in pipes, `Logger`, `ConfigurableModuleBuilder` |
| `@drogonjs/core` | DI container, module graph, application context, router, middleware, versioning, CORS |
| `@drogonjs/platform-elysia` | Elysia HTTP adapter |
| `@drogonjs/platform-hono` | Hono HTTP adapter |
| `@drogonjs/testing` | `Test.createTestingModule`, provider/enhancer/module overrides |
| `@drogonjs/config` | `ConfigModule`, `ConfigService`, `registerAs`, `.env` loading |
| `@drogonjs/db` | TypeORM-style entities and repositories on Drizzle (Postgres, MySQL, SQLite) — see [its README](packages/db/README.md) |
| `@drogonjs/openapi` | OpenAPI document from controller metadata |
| `@drogonjs/cli`, `create-drogonjs` | Generators and project scaffolding |

## NestJS features

Both adapters share one pipeline in `@drogonjs/core`, so everything below
behaves the same on Elysia and Hono.

**Dependency injection** — constructor and property injection (`@Inject()` on a
property), `@Optional()`, singleton/transient/request scopes, `forwardRef()` for
circular imports and mutually dependent providers, optional factory
dependencies (`inject: [{ token, optional: true }]`), and an injectable
`ModuleRef` (`get`, `resolve`, `create`). `Reflector` and `ModuleRef` are
injectable in every module without importing anything.

**Modules** — static and dynamic modules, `@Global()`, async providers, and
`ConfigurableModuleBuilder` for `forRoot`/`forRootAsync`. Lifecycle hooks:
`onModuleInit`, `onApplicationBootstrap`, `onModuleDestroy`,
`beforeApplicationShutdown`, `onApplicationShutdown`.

**Request pipeline** — middleware, guards, interceptors, pipes, filters, then
the handler:

```ts
@Module({
  controllers: [CatsController],
  providers: [
    { provide: APP_GUARD, useClass: RolesGuard },        // global, built with DI
    { provide: APP_PIPE, useValue: new ValidationPipe({ transform: true, whitelist: true }) }
  ]
})
export class AppModule implements DrogonModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).exclude('health').forRoutes('*');
  }
}
```

- Middleware receives the Fetch `Request` (shared with guards via
  `getRequest()`), a `ResponseHandle` and `next`; classes are built with DI,
  plain functions work too.
- Metadata: `SetMetadata`, `Reflector.createDecorator`, and
  `reflector.getAllAndOverride` / `getAllAndMerge`.
- Custom parameter decorators with `createParamDecorator((data, ctx) => …)`.
- Built-in pipes: `ValidationPipe` (class-validator + class-transformer, optional
  peers), `SchemaValidationPipe` (any Standard Schema: Zod, Valibot, ArkType),
  `ParseIntPipe`, `ParseFloatPipe`, `ParseBoolPipe`, `ParseUUIDPipe`,
  `ParseEnumPipe`, `ParseArrayPipe`, `ParseDatePipe`, `DefaultValuePipe`.
- Response decorators: `@HttpCode`, `@Header`, `@Redirect`.
- The full set of `HttpException` subclasses and `HttpStatus`; unhandled errors
  are logged and answered with `{ statusCode: 500, message: 'Internal server error' }`.

**Application options** (both `createElysiaApplication` and
`createHonoApplication`):

```ts
const { app } = await createHonoApplication(AppModule, {
  globalPrefix: { prefix: 'api', exclude: ['health'] },
  versioning: { type: VersioningType.URI },        // or HEADER, MEDIA_TYPE, CUSTOM
  cors: { origin: ['https://app.example'], credentials: true },
  globalPipes: [new ValidationPipe()]
});
```

Use `@Version('2')` / `@Controller({ path, version })`, and `VERSION_NEUTRAL`
for routes served under every version.

**Testing** — `Test.createTestingModule(...)` with `overrideProvider`,
`overrideGuard`, `overrideInterceptor`, `overridePipe`, `overrideFilter` and
`overrideModule`; `moduleRef.createApplication(createHonoApplication)` serves the
testing module over HTTP.

**Not implemented yet** — WebSocket gateways, microservices, GraphQL,
`@Sse()`, `@Render()`, file-upload interceptors (multipart bodies are parsed;
read files with `@Body('file')`), host-based routing, and durable request scopes.
Interceptors use Promises rather than RxJS Observables.

## Database and configuration

```ts
import { ConfigModule, ConfigService } from '@drogonjs/config';
import { Column, DrizzleModule, Entity, InjectRepository, PrimaryGeneratedColumn, Repository } from '@drogonjs/db';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ unique: true }) email!: string;
}

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  findByEmail(email: string) {
    return this.users.findOneBy({ email });
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dialect: 'postgres',               // or 'mysql', 'sqlite'
        url: config.getOrThrow('DATABASE_URL'),
        autoLoadEntities: true
      })
    }),
    DrizzleModule.forFeature([User])
  ],
  providers: [UsersService]
})
export class AppModule {}
```

Entities compile to real Drizzle tables (`toTable`, `buildSchema`), so
drizzle-kit migrations and raw Drizzle queries (`repository.db`,
`repository.table`) work alongside the repository API. Full reference in
[packages/db/README.md](packages/db/README.md).

## Development

```bash
bun install
bun run build       # bun build + tsc --emitDeclarationOnly, per package
bun run typecheck   # tsc --noEmit, per package
bun test            # always from the repository root
bun run clean       # drops dist/ and any .d.ts that leaked beside the sources
```

The MySQL integration tests of `@drogonjs/db` run only when `MYSQL_URL` is set:

```bash
docker run --rm -d -p 3306:3306 -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=drogon mysql:8.4
MYSQL_URL=mysql://root:root@127.0.0.1:3306/drogon bun test packages/db
```

### Workspace layout

```
drogonjs/
  packages/            # published packages (@drogonjs/*, create-drogonjs)
  examples/            # runnable example applications
  scripts/             # release tooling
  .changeset/          # pending release notes (see Releasing)
  .github/workflows/   # CI and release pipelines
  tsconfig.base.json   # compiler options shared by every config
  tsconfig.dev.json    # base + workspace path mapping (source, not dist)
  tsconfig.json        # what Bun and `tsc --noEmit` read at the repo root
  bunfig.toml
  package.json
```

### TypeScript configuration

Three layers, because Bun and `tsc` need different things from the same options:

| File | Purpose |
| --- | --- |
| `tsconfig.base.json` | Compiler options only — no `include`, no `paths`. |
| `tsconfig.dev.json` | Adds `paths` mapping `@drogonjs/*` to `packages/*/src/index.ts`. |
| `tsconfig.json` (root and per package) | Extends `tsconfig.dev.json`, `noEmit`. Used for development and `typecheck`. |
| `packages/*/tsconfig.build.json` | Extends `tsconfig.base.json` with `rootDir`/`outDir`. Used for `build`. |

Two details worth knowing before editing these:

- **A root `tsconfig.json` is required.** Bun reads `tsconfig.json`, not
  `tsconfig.base.json`, to decide between legacy and TC39 decorators. Without it
  Bun applies stage-3 semantics, and every method and parameter decorator becomes
  a silent no-op — `design:paramtypes` is never emitted, so DI and routing break
  with no error. Bun uses the config *nearest the importing file*, which is why
  each package carries its own `tsconfig.json` as well.
- **`paths` is deliberately absent from the build configs.** Bun honours `paths`
  at runtime, so tests and examples load workspace packages from `src` rather
  than a stale `dist`. Leaving it in a build config would make
  `tsc --emitDeclarationOnly` pull cross-package sources into `dist`.

### Notes

- Always run `bun test` from the repository root: the `reflect-metadata`
  preload is configured in the root `bunfig.toml`.
- Elysia's `@sinclair/typebox` and `openapi-types` peers are installed
  automatically (`peer = true` in `bunfig.toml`); `@drogonjs/platform-elysia`
  and `@drogonjs/openapi` also declare them directly.
- `bun test` skips `packages/create-drogonjs/templates/**`: those specs import
  packages that only exist inside a scaffolded project.
- Decorator metadata relies on `experimentalDecorators` + `emitDecoratorMetadata`,
  set in `tsconfig.base.json` and inherited by every config above.

## Releasing

Releases are automated with [Changesets](https://changesets.dev) and GitHub
Actions; nobody publishes from a laptop.

1. **With every change** to a published package, add a changeset and commit it
   with the change:

   ```bash
   bun run changeset      # pick packages, choose patch/minor/major, describe the change
   ```

   Changes that should not release anything (docs, CI, tests) can use
   `bun run changeset --empty`. CI fails a pull request that changes a package
   without a changeset.

2. **On `main`**, the *Release* workflow collects pending changesets into a
   **chore: version packages** pull request. It bumps versions, updates the
   ranges between `@drogonjs/*` packages, writes each `CHANGELOG.md` and
   refreshes `bun.lock`. It stays open and updates itself as more changes land.

3. **Merging that pull request** publishes every package whose version is not
   on npm yet, with [provenance](https://docs.npmjs.com/generating-provenance-statements),
   then pushes a `<package>@<version>` tag and a GitHub release for each.

Prereleases: `bunx changeset pre enter next` makes the following versions
`x.y.z-next.N`, published under the `next` dist-tag; `bunx changeset pre exit`
returns to normal releases.

### Pipelines

| Workflow | Runs on | Does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | pull requests, pushes to `main` | Typecheck, build, test (with a MySQL service for the db integration suite); checks pull requests for a changeset |
| `.github/workflows/release.yml` | pushes to `main`, manual | Tests, then opens/updates the version pull request or publishes to npm |

### One-time setup

- **npm access.** The `@drogonjs` scope and `create-drogonjs` must be owned by
  the npm account or organization publishing them.
- **Authentication**, either:
  - *Trusted publishing (recommended, no secret):* on npmjs.com, open each
    package's **Settings → Trusted publishing**, add GitHub Actions with this
    repository and the workflow file `release.yml`. npm only offers this for
    packages that already exist, so new packages (`@drogonjs/config`,
    `@drogonjs/db`) need their first publish through a token.
  - *Token:* create a granular access token with publish rights to the
    packages and save it as the repository secret `NPM_TOKEN`. The workflow
    uses it when present and falls back to trusted publishing otherwise.
- **GitHub.** In **Settings → Actions → General**, enable *Allow GitHub Actions
  to create and approve pull requests*. Pull requests opened with the default
  token do not trigger other workflows, so CI will not run on the version pull
  request on its own; the release workflow runs the tests before publishing.
- **Repository metadata.** Provenance requires `repository.url` in each
  `package.json` to match the GitHub repository. `scripts/prepare-publish.ts`
  fills it in during the release run when it is missing, but adding it (and a
  `license`) to the manifests is better.
