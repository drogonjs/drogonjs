import { describe, expect, it } from 'bun:test';
import {
  Controller,
  Get,
  Injectable,
  Module,
  UseGuards,
  UseInterceptors,
  type CallHandler,
  type CanActivate,
  type DrogonInterceptor
} from '@drogonjs/common';
import { createHonoApplication } from '@drogonjs/platform-hono';
import { Test } from '../src/index';

class DenyAll implements CanActivate {
  canActivate() {
    return false;
  }
}

class Shout implements DrogonInterceptor {
  async intercept(_context: unknown, next: CallHandler) {
    return String(await next.handle()).toUpperCase();
  }
}

@Controller('/secret')
@UseGuards(DenyAll)
class SecretController {
  @Get('/')
  @UseInterceptors(Shout)
  read() {
    return 'hello';
  }
}

@Injectable()
class RealMailer {
  send() {
    return 'real';
  }
}

@Module({ providers: [RealMailer], exports: [RealMailer] })
class MailModule {}

@Injectable()
class FakeMailer {
  send() {
    return 'fake';
  }
}

@Module({ providers: [{ provide: RealMailer, useClass: FakeMailer }], exports: [RealMailer] })
class FakeMailModule {}

describe('TestingModule overrides', () => {
  it('replaces guards and interceptors and serves the module over HTTP', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [SecretController] })
      .overrideGuard(DenyAll)
      .useValue({ canActivate: () => true })
      .overrideInterceptor(Shout)
      .useFactory(() => ({ intercept: async (_c: unknown, next: CallHandler) => `[${await next.handle()}]` }))
      .compile();

    const { app } = await moduleRef.createApplication(createHonoApplication);
    const response = await app.request('/secret');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('[hello]');
  });

  it('keeps the real enhancers when nothing is overridden', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [SecretController] }).compile();
    const { app } = await moduleRef.createApplication(createHonoApplication);
    expect((await app.request('/secret')).status).toBe(403);
  });

  it('swaps an imported module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [MailModule] })
      .overrideModule(MailModule)
      .useModule(FakeMailModule)
      .compile();
    expect((await moduleRef.get(RealMailer)).send()).toBe('fake');
  });
});
