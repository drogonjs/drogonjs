# __PROJECT_NAME__

A [DrogonJS](https://github.com/DrogonJS/DrogonJS) application on the **Hono** adapter, running on Bun.

## Getting started

```bash
bun install
bun dev
```

The server listens on `http://localhost:3000` (override with `PORT`).

| Route | Description |
| --- | --- |
| `GET /` | Service status, produced by `AppService` |
| `GET /hello/:name` | Echoes a greeting for the route parameter |

## Scripts

| Script | What it does |
| --- | --- |
| `bun dev` | Start with file watching |
| `bun start` | Start once |
<!-- #if tests -->
| `bun test` | Run the test suite |
<!-- #endif -->
| `bun run typecheck` | Type-check without emitting |

## Layout

```
src/
  main.ts                     builds the app and exports a fetch handler
  modules/
    app/
      app.module.ts           wires the controller and provider together
      app.controller.ts       routes
      app.service.ts          business logic, injected into the controller
<!-- #if tests -->
test/
  app.test.ts                 resolves the controller through @drogonjs/testing
<!-- #endif -->
```

Add more modules with the CLI:

```bash
bunx @drogonjs/cli generate resource users
```

## Notes

- **`experimentalDecorators` and `emitDecoratorMetadata` must stay enabled** in
  `tsconfig.json`. Bun picks its decorator semantics from the nearest
  `tsconfig.json`; without those flags it applies stage-3 decorators and every
  method and parameter decorator silently stops registering metadata.
- `main.ts` exports `{ port, fetch }` instead of calling `listen`, so the same
  handler deploys unchanged to Cloudflare Workers, Deno or Node.
- OpenAPI generation is Elysia-only today: `@drogonjs/openapi` wraps
  `@elysia/openapi`. Scaffold with `--adapter elysia` if you need it.
<!-- #if tests -->
- Tests resolve real instances from the container, so `overrideProvider()` is the
  seam for stubbing: no module mocking required.
<!-- #endif -->
