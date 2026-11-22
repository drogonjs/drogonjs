# @drogonjs/platform-elysia

## 0.2.0

### Minor Changes

- 2673765: NestJS feature parity: middleware (`configure(consumer)`), `Reflector` and `SetMetadata`, `createParamDecorator`, `forwardRef`, property injection, injectable `ModuleRef`, `ConfigurableModuleBuilder`, `APP_GUARD`/`APP_PIPE`/`APP_INTERCEPTOR`/`APP_FILTER`, built-in pipes (`ValidationPipe`, `SchemaValidationPipe`, `Parse*Pipe`, `DefaultValuePipe`), `@Header`, `@Redirect`, `Logger`, the full set of HTTP exceptions, global prefix, URI/header/media-type/custom versioning, CORS, testing overrides for guards, interceptors, pipes, filters and modules, and CLI generators for guards, interceptors, pipes, filters and middleware.
  
  Breaking: core's `ModuleRef` interface (module and container pair) is renamed `ModuleEntry`; adapters read `@HttpCode` from `RouteOutcome.defaultStatus`; unhandled errors answer `{ statusCode: 500, message: 'Internal server error' }`.

### Patch Changes

- Updated dependencies [2673765]
  - @drogonjs/common@0.2.0
  - @drogonjs/core@0.2.0
