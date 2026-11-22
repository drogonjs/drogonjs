/**
 * Behaviour every HTTP adapter must share. Imported by each adapter's tests,
 * so the two can never drift apart.
 */
import { describe, expect, it } from 'bun:test';
import {
  BadRequestException,
  Body,
  Catch,
  Controller,
  Cookie,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Ip,
  Module,
  NotFoundException,
  Param,
  Post,
  REQUEST,
  Res,
  Scope,
  UseFilters,
  UseGuards,
  UseInterceptors,
  UsePipes,
  type ArgumentMetadata,
  type CallHandler,
  type CanActivate,
  type DrogonInterceptor,
  type ExceptionFilter,
  type ExecutionContext,
  type ModuleImport,
  type PipeTransform,
  type ResponseHandle
} from '@drogonjs/common';

export type Fetch = (path: string, init?: RequestInit) => Promise<Response>;
export type CreateFetch = (root: ModuleImport, options?: Record<string, unknown>) => Promise<Fetch>;

class DenyGuard implements CanActivate {
  canActivate() {
    return false;
  }
}

@Injectable()
class TokenService {
  readonly expected = 'secret';
}

@Injectable()
class TokenGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext) {
    const headers = context.switchToHttp().getHeaders<Record<string, string>>();
    return headers['x-token'] === this.tokens.expected;
  }
}

class BodyGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    return context.switchToHttp().getBody<{ allowed?: boolean }>()?.allowed === true;
  }
}

class WrapInterceptor implements DrogonInterceptor {
  constructor(private readonly label: string) {}

  async intercept(_context: ExecutionContext, next: CallHandler) {
    return { [this.label]: await next.handle() };
  }
}

class ParseIntPipe implements PipeTransform<string, number> {
  transform(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) throw new BadRequestException(`${value} is not an integer`);
    return parsed;
  }
}

const seenMetadata: ArgumentMetadata[] = [];

class RecordPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    seenMetadata.push(metadata);
    return value;
  }
}

class TeapotError extends Error {}

@Catch(TeapotError)
class TeapotFilter implements ExceptionFilter<TeapotError> {
  catch(error: TeapotError) {
    return new Response(`teapot: ${error.message}`, { status: 418 });
  }
}

class CatchAllFilter implements ExceptionFilter {
  catch(error: unknown) {
    return { caught: (error as Error).message };
  }
}

@Controller('/guarded')
class GuardedController {
  @Get('/denied')
  @UseGuards(DenyGuard)
  denied() {
    return { reached: true };
  }

  @Get('/token')
  @UseGuards(TokenGuard)
  token() {
    return { reached: true };
  }

  @Post('/body')
  @UseGuards(BodyGuard)
  body(@Body() body: unknown) {
    return body;
  }

  @Get('/open')
  open() {
    return { reached: true };
  }
}

@Controller('/locked')
@UseGuards(DenyGuard)
class LockedController {
  @Get('/')
  index() {
    return { reached: true };
  }
}

@Controller('/enhanced')
@UseInterceptors(new WrapInterceptor('outer'))
class EnhancedController {
  @Get('/wrapped')
  @UseInterceptors(new WrapInterceptor('inner'))
  wrapped() {
    return 'value';
  }

  @Get('/int/:id')
  int(@Param('id', ParseIntPipe) id: number) {
    return { id, type: typeof id };
  }

  @Post('/recorded/:id')
  @UsePipes(RecordPipe)
  recorded(@Param('id') id: string, @Body('name') name: string) {
    return { id, name };
  }

  @Get('/teapot')
  @UseFilters(TeapotFilter)
  teapot() {
    throw new TeapotError('short and stout');
  }

  @Get('/unmatched')
  @UseFilters(TeapotFilter)
  unmatched() {
    throw new NotFoundException('still a 404');
  }

  @Get('/caught')
  @UseFilters(CatchAllFilter)
  caught() {
    throw new NotFoundException('gone');
  }

  @Get('/crash')
  crash() {
    throw new Error('unexpected');
  }
}

let requestServiceCount = 0;

@Injectable({ scope: Scope.REQUEST })
class RequestService {
  readonly id = ++requestServiceCount;

  constructor(@Inject(REQUEST) readonly request: Request) {}
}

@Controller('/scoped')
class ScopedController {
  constructor(private readonly service: RequestService) {}

  @Get('/')
  index() {
    return { id: this.service.id, url: new URL(this.service.request.url).pathname };
  }
}

@Controller('/io')
class IoController {
  @Get('/headers')
  headers(@Headers('X-Token') token: string, @Headers() all: Record<string, string>) {
    return { token, hasAll: typeof all === 'object' && all['x-token'] === token };
  }

  @Get('/cookies')
  cookies(@Cookie('sid') sid: string, @Cookie() all: Record<string, string>) {
    return { sid, all };
  }

  @Post('/body-key')
  bodyKey(@Body('name') name: string) {
    return { name };
  }

  @Post('/res')
  @HttpCode(201)
  res(@Res() res: ResponseHandle) {
    res.status(202).header('x-drogon', 'yes');
    return { ok: true };
  }

  @Get('/empty')
  empty() {
    return undefined;
  }

  @Post('/empty-created')
  @HttpCode(201)
  emptyCreated() {
    return undefined;
  }

  @Get('/ip')
  ip(@Ip() ip: string | null) {
    return { ip };
  }
}

@Module({
  controllers: [GuardedController, LockedController, EnhancedController, ScopedController, IoController],
  providers: [TokenService, RequestService]
})
class AppModule {}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

export function describeAdapterPipeline(name: string, create: CreateFetch) {
  describe(`${name} request pipeline`, async () => {
    const fetch = await create(AppModule);

    it('rejects a request when a method guard returns false', async () => {
      const response = await fetch('/guarded/denied');
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ statusCode: 403, message: 'Forbidden resource' });
    });

    it('builds class guards through DI and passes them the request', async () => {
      expect((await fetch('/guarded/token')).status).toBe(403);
      const allowed = await fetch('/guarded/token', { headers: { 'x-token': 'secret' } });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({ reached: true });
    });

    it('lets guards read the request body', async () => {
      expect((await fetch('/guarded/body', json({ allowed: false }))).status).toBe(403);
      const allowed = await fetch('/guarded/body', json({ allowed: true }));
      expect(await allowed.json()).toEqual({ allowed: true });
    });

    it('applies class-level guards to every route of the controller', async () => {
      expect((await fetch('/locked')).status).toBe(403);
    });

    it('applies global guards', async () => {
      const locked = await create(AppModule, { globalGuards: [DenyGuard] });
      expect((await locked('/guarded/open')).status).toBe(403);
    });

    it('runs interceptors outermost first, controller before method', async () => {
      expect(await (await fetch('/enhanced/wrapped')).json()).toEqual({ outer: { inner: 'value' } });
    });

    it('transforms a parameter through its pipe', async () => {
      expect(await (await fetch('/enhanced/int/42')).json()).toEqual({ outer: { id: 42, type: 'number' } });
    });

    it('maps an exception thrown by a pipe', async () => {
      expect((await fetch('/enhanced/int/nope')).status).toBe(400);
    });

    it('runs method pipes on params and body with argument metadata', async () => {
      seenMetadata.length = 0;
      const response = await fetch('/enhanced/recorded/7', json({ name: 'ada' }));

      expect(await response.json()).toEqual({ outer: { id: '7', name: 'ada' } });
      expect(seenMetadata).toEqual([
        { type: 'param', metatype: String, data: 'id' },
        { type: 'body', metatype: String, data: 'name' }
      ]);
    });

    it('hands a matching exception to its filter', async () => {
      const response = await fetch('/enhanced/teapot');
      expect(response.status).toBe(418);
      expect(await response.text()).toBe('teapot: short and stout');
    });

    it('falls back to the default mapping when no filter matches', async () => {
      const response = await fetch('/enhanced/unmatched');
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ statusCode: 404, message: 'still a 404' });
    });

    it('lets a catch-all filter shape the body while keeping the exception status', async () => {
      const response = await fetch('/enhanced/caught');
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ caught: 'gone' });
    });

    it('answers an unhandled error with 500', async () => {
      expect((await fetch('/enhanced/crash')).status).toBe(500);
    });

    it('creates request-scoped providers per request and injects REQUEST', async () => {
      const first = await (await fetch('/scoped')).json();
      const second = await (await fetch('/scoped')).json();

      expect(first.url).toBe('/scoped');
      expect(second.id).not.toBe(first.id);
    });

    it('reads one header by key, case-insensitively', async () => {
      const response = await fetch('/io/headers', { headers: { 'x-token': 'abc' } });
      expect(await response.json()).toEqual({ token: 'abc', hasAll: true });
    });

    it('reads one cookie by key, or all of them parsed', async () => {
      const response = await fetch('/io/cookies', { headers: { cookie: 'sid=1; theme=dark%20mode' } });
      expect(await response.json()).toEqual({ sid: '1', all: { sid: '1', theme: 'dark mode' } });
    });

    it('reads one body field by key', async () => {
      expect(await (await fetch('/io/body-key', json({ name: 'ada', extra: 1 }))).json()).toEqual({ name: 'ada' });
    });

    it('sets status and headers through @Res(), over @HttpCode', async () => {
      const response = await fetch('/io/res', { method: 'POST' });
      expect(response.status).toBe(202);
      expect(response.headers.get('x-drogon')).toBe('yes');
    });

    it('answers an empty result with 204, or the declared @HttpCode', async () => {
      expect((await fetch('/io/empty')).status).toBe(204);
      expect((await fetch('/io/empty-created', { method: 'POST' })).status).toBe(201);
    });

    it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
      const headers = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
      expect(await (await fetch('/io/ip', { headers })).json()).toEqual({ ip: null });

      const trusting = await create(AppModule, { trustProxy: true });
      expect(await (await trusting('/io/ip', { headers })).json()).toEqual({ ip: '203.0.113.7' });
    });

    it('accepts a dynamic module as the root', async () => {
      @Module({})
      class DynamicRoot {}

      const dynamic = await create({ module: DynamicRoot, controllers: [IoController] });
      expect((await dynamic('/io/empty')).status).toBe(204);
    });
  });
}
