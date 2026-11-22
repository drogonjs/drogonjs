# __PROJECT_NAME__

A [DrogonJS](https://github.com/DrogonJS/DrogonJS) application on the **Elysia** adapter, running on Bun.

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
<!-- #if openapi -->
| `GET /openapi` | Interactive OpenAPI document |
<!-- #endif -->

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
  main.ts                     bootstraps the adapter and starts listening
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
- `elysia` is pinned to an exact version that matches the one
  `@drogonjs/platform-elysia` depends on. Keeping them identical guarantees a
  single Elysia instance in the dependency tree — two copies break plugins and
  `instanceof` checks.
<!-- #if tests -->
- Tests resolve real instances from the container, so `overrideProvider()` is the
  seam for stubbing: no module mocking required.
<!-- #endif -->
