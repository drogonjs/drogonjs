/**
 * NestJS-style features every HTTP adapter must support: middleware, metadata,
 * custom parameters, built-in pipes, APP_* enhancers, response decorators,
 * global prefix, versioning and CORS.
 */
import { describe, expect, it } from 'bun:test';
import { IsInt, IsString, Min } from 'class-validator';
import {
  APP_GUARD,
  APP_INTERCEPTOR,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Redirect,
  Reflector,
  RequestMethod,
  SetMetadata,
  UsePipes,
  ValidationPipe,
  Version,
  VERSION_NEUTRAL,
  VersioningType,
  createParamDecorator,
  type CallHandler,
  type CanActivate,
  type DrogonInterceptor,
  type DrogonMiddleware,
  type DrogonModule,
  type ExecutionContext,
  type MiddlewareConsumer,
  type ResponseHandle
} from '@drogonjs/common';
import type { CreateFetch } from './adapter-suite';

const Roles = Reflector.createDecorator<string[]>();
const Public = () => SetMetadata('isPublic', true);

const CurrentUser = createParamDecorator((field: string | undefined, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<Request & { user?: Record<string, unknown> }>().user;
  return field ? user?.[field] : user;
});

@Injectable()
class AuditLog {
  readonly entries: string[] = [];
}

@Injectable()
class AuthMiddleware implements DrogonMiddleware {
  constructor(private readonly audit: AuditLog) {}

  async use(req: Request & { user?: unknown }, _res: ResponseHandle, next: () => Promise<void>) {
    const name = req.headers.get('x-user');
    if (name) req.user = { name, roles: req.headers.get('x-roles')?.split(',') ?? [] };
    this.audit.entries.push(`auth:${new URL(req.url).pathname}`);
    await next();
  }
}

function blockMiddleware(req: Request, _res: ResponseHandle, next: () => Promise<void>) {
  if (req.headers.get('x-block')) return { blocked: true };
  return next();
}

@Injectable()
class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>('isPublic', [context.getHandler(), context.getClass()])) return true;
    const required = this.reflector.getAllAndOverride(Roles, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: { roles: string[] } }>().user;
    return required.some(role => user?.roles.includes(role));
  }
}

@Injectable()
class EnvelopeInterceptor implements DrogonInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler) {
    const value = await next.handle();
    return context.getType() === 'http' && value && typeof value === 'object' && !Array.isArray(value)
      ? { ...value, enveloped: true }
      : value;
  }
}

class CreateCatDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  age!: number;
}

@Controller('/features')
@Roles(['admin'])
class FeaturesController {
  @Get('/me')
  @Public()
  me(@CurrentUser() user: unknown, @CurrentUser('name') name: unknown) {
    return { user: user ?? null, name: name ?? null };
  }

  @Get('/admin')
  admin() {
    return { ok: true };
  }

  @Get('/items/:id')
  @Public()
  item(@Param('id', ParseIntPipe) id: number, @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    return { id, idType: typeof id, page };
  }

  @Get('/uuid/:id')
  @Public()
  uuid(@Param('id', ParseUUIDPipe) id: string) {
    return { id };
  }

  @Post('/cats')
  @Public()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  createCat(@Body() dto: CreateCatDto) {
    return { isDto: dto instanceof CreateCatDto, dto: { ...dto } };
  }

  @Get('/headers')
  @Public()
  @Header('Cache-Control', 'no-store')
  headers() {
    return { ok: true };
  }

  @Get('/redirect')
  @Public()
  @Redirect('https://example.com/docs', 301)
  redirect(@Query('version') version?: string) {
    if (version) return { url: `https://example.com/v${version}/docs` };
    return undefined;
  }
}

@Controller('/open')
class OpenController {
  @Get('/')
  index() {
    return { open: true };
  }
}

@Module({
  controllers: [FeaturesController, OpenController],
  providers: [
    AuditLog,
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor }
  ],
  exports: [AuditLog]
})
class FeaturesModule implements DrogonModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).exclude({ path: 'open', method: RequestMethod.GET }).forRoutes('*');
    consumer.apply(blockMiddleware).forRoutes(FeaturesController);
  }
}

@Controller({ path: '/cats', version: '1' })
class CatsV1Controller {
  @Get('/')
  list() {
    return { version: 1 };
  }

  @Get('/latest')
  @Version(['2', VERSION_NEUTRAL])
  latest() {
    return { latest: true };
  }
}

@Controller('/cats')
@Version('2')
class CatsV2Controller {
  @Get('/')
  list() {
    return { version: 2 };
  }
}

@Module({ controllers: [CatsV1Controller, CatsV2Controller] })
class VersionedModule {}

export function describeAdapterFeatures(name: string, create: CreateFetch) {
  describe(`${name} NestJS features`, () => {
    it('runs class middleware through DI and exposes what it attaches to the request', async () => {
      const fetch = await create(FeaturesModule);
      const response = await fetch('/features/me', { headers: { 'x-user': 'ada', 'x-roles': 'admin' } });
      expect(await response.json()).toEqual({ user: { name: 'ada', roles: ['admin'] }, name: 'ada', enveloped: true });
    });

    it('lets functional middleware answer without calling next', async () => {
      const fetch = await create(FeaturesModule);
      const response = await fetch('/features/me', { headers: { 'x-block': '1' } });
      expect(await response.json()).toEqual({ blocked: true });
    });

    it('excludes routes from middleware', async () => {
      const fetch = await create(FeaturesModule);
      const response = await fetch('/open', { headers: { 'x-user': 'ada' } });
      expect(await response.json()).toEqual({ open: true, enveloped: true });
    });

    it('reads class and handler metadata through Reflector in an APP_GUARD', async () => {
      const fetch = await create(FeaturesModule);
      expect((await fetch('/features/admin')).status).toBe(403);
      expect((await fetch('/features/admin', { headers: { 'x-user': 'a', 'x-roles': 'admin' } })).status).toBe(200);
      expect((await fetch('/features/admin', { headers: { 'x-user': 'a', 'x-roles': 'user' } })).status).toBe(403);
    });

    it('parses params with built-in pipes, including defaults', async () => {
      const fetch = await create(FeaturesModule);
      expect(await (await fetch('/features/items/42')).json()).toEqual({ id: 42, idType: 'number', page: 1, enveloped: true });
      expect(await (await fetch('/features/items/42?page=3')).json()).toMatchObject({ page: 3 });

      const invalid = await fetch('/features/items/abc');
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ statusCode: 400, message: 'Validation failed (numeric string is expected)' });

      expect((await fetch('/features/uuid/not-a-uuid')).status).toBe(400);
      expect((await fetch('/features/uuid/3b241101-e2bb-4255-8caf-4136c566a962')).status).toBe(200);
    });

    it('validates and transforms DTOs with ValidationPipe', async () => {
      const fetch = await create(FeaturesModule);
      const post = (body: unknown) =>
        fetch('/features/cats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

      const ok = await post({ name: 'Tom', age: 3 });
      expect(await ok.json()).toEqual({ isDto: true, dto: { name: 'Tom', age: 3 }, enveloped: true });

      const invalid = await post({ name: 5, age: -1 });
      expect(invalid.status).toBe(400);
      const body = (await invalid.json()) as { message: string[]; error: string };
      expect(body.error).toBe('Bad Request');
      expect(body.message).toEqual(expect.arrayContaining(['name must be a string', 'age must not be less than 0']));

      const extra = await post({ name: 'Tom', age: 3, admin: true });
      expect(extra.status).toBe(400);
      expect(((await extra.json()) as { message: string[] }).message).toEqual(['property admin should not exist']);
    });

    it('sets @Header headers and answers @Redirect routes', async () => {
      const fetch = await create(FeaturesModule);
      expect((await fetch('/features/headers')).headers.get('cache-control')).toBe('no-store');

      const declared = await fetch('/features/redirect', { redirect: 'manual' });
      expect(declared.status).toBe(301);
      expect(declared.headers.get('location')).toBe('https://example.com/docs');

      const dynamic = await fetch('/features/redirect?version=5', { redirect: 'manual' });
      expect(dynamic.headers.get('location')).toBe('https://example.com/v5/docs');
    });

    it('mounts routes under a global prefix, minus exclusions', async () => {
      const fetch = await create(FeaturesModule, { globalPrefix: { prefix: 'api', exclude: ['open'] } });
      expect((await fetch('/api/features/headers')).status).toBe(200);
      expect((await fetch('/features/headers')).status).toBe(404);
      expect((await fetch('/open')).status).toBe(200);
    });

    it('serves URI versions', async () => {
      const fetch = await create(VersionedModule, { versioning: { type: VersioningType.URI } });
      expect(await (await fetch('/v1/cats')).json()).toEqual({ version: 1 });
      expect(await (await fetch('/v2/cats')).json()).toEqual({ version: 2 });
      expect(await (await fetch('/v2/cats/latest')).json()).toEqual({ latest: true });
      expect(await (await fetch('/cats/latest')).json()).toEqual({ latest: true });
      expect((await fetch('/cats')).status).toBe(404);
    });

    it('dispatches header versions on one path', async () => {
      const fetch = await create(VersionedModule, {
        globalPrefix: 'api',
        versioning: { type: VersioningType.HEADER, header: 'x-api-version' }
      });
      const get = (version?: string) => fetch('/api/cats', { headers: version ? { 'x-api-version': version } : {} });
      expect(await (await get('1')).json()).toEqual({ version: 1 });
      expect(await (await get('2')).json()).toEqual({ version: 2 });
      expect((await get('3')).status).toBe(404);
      expect((await get()).status).toBe(404);
      expect(await (await fetch('/api/cats/latest')).json()).toEqual({ latest: true });
    });

    it('dispatches media-type versions with a default version', async () => {
      const fetch = await create(VersionedModule, {
        versioning: { type: VersioningType.MEDIA_TYPE, key: 'v=', defaultVersion: '1' }
      });
      expect(await (await fetch('/cats', { headers: { accept: 'application/json;v=2' } })).json()).toEqual({ version: 2 });
      expect(await (await fetch('/cats', { headers: { accept: 'application/json;v=1' } })).json()).toEqual({ version: 1 });
    });

    it('answers CORS preflights and decorates responses', async () => {
      const fetch = await create(FeaturesModule, { cors: { origin: ['https://app.example'], credentials: true } });
      const preflight = await fetch('/features/headers', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-user' }
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.example');
      expect(preflight.headers.get('access-control-allow-headers')).toBe('x-user');
      expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');

      const simple = await fetch('/features/headers', { headers: { origin: 'https://app.example' } });
      expect(simple.headers.get('access-control-allow-origin')).toBe('https://app.example');

      const foreign = await fetch('/features/headers', { headers: { origin: 'https://evil.example' } });
      expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('answers an unhandled error with the NestJS 500 body', async () => {
      @Controller('/boom')
      class BoomController {
        @Get('/')
        boom() {
          throw new Error('kaboom');
        }
      }
      @Module({ controllers: [BoomController] })
      class BoomModule {}

      const fetch = await create(BoomModule);
      const { Logger } = await import('@drogonjs/common');
      Logger.overrideLogger(false);
      try {
        const response = await fetch('/boom');
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
      } finally {
        Logger.overrideLogger(true);
      }
    });
  });
}
