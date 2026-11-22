import { describe, expect, it, mock } from 'bun:test';
import { Injectable, Module } from '@drogonjs/common';
import { Test } from '../src/index';

@Injectable()
class ConfigService {
  getName() {
    return 'real';
  }
}

@Injectable()
class UsersService {
  constructor(private readonly config: ConfigService) {}

  name() {
    return this.config.getName();
  }
}

@Module({
  providers: [ConfigService, UsersService]
})
class UsersModule {}

describe('@drogonjs/testing', () => {
  it('creates a testing module and resolves providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UsersModule]
    }).compile();

    const service = await moduleRef.get(UsersService);
    expect(service.name()).toBe('real');
  });

  it('overrides providers with useValue from imported modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UsersModule]
    })
      .overrideProvider(ConfigService)
      .useValue({ getName: () => 'mocked' })
      .compile();

    const service = await moduleRef.get(UsersService);
    expect(service.name()).toBe('mocked');
  });

  it('works with bun mock functions', async () => {
    const getName = mock(() => 'spy-mocked');

    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: ConfigService, useValue: { getName } }]
    }).compile();

    const service = await moduleRef.get(UsersService);
    expect(service.name()).toBe('spy-mocked');
    expect(getName).toHaveBeenCalledTimes(1);
  });

  it('resolves non-class provider tokens declared by an imported module', async () => {
    @Module({ providers: [{ provide: 'CONFIG', useValue: { url: 'db://real' } }] })
    class ConfigModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule] }).compile();

    expect(await moduleRef.get<{ url: string }>('CONFIG')).toEqual({ url: 'db://real' });
  });

  it('resolves providers from a module nested two levels deep', async () => {
    @Module({ providers: [{ provide: 'DEEP', useValue: 'found' }] })
    class DeepModule {}
    @Module({ imports: [DeepModule] })
    class MiddleModule {}

    const moduleRef = await Test.createTestingModule({ imports: [MiddleModule] }).compile();

    expect(await moduleRef.get<string>('DEEP')).toBe('found');
  });

  it('overrides a token provider from an imported module', async () => {
    @Module({ providers: [{ provide: 'CONFIG', useValue: { url: 'db://real' } }] })
    class ConfigModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule] })
      .overrideProvider('CONFIG')
      .useValue({ url: 'db://test' })
      .compile();

    expect(await moduleRef.get<{ url: string }>('CONFIG')).toEqual({ url: 'db://test' });
  });

  it('supports overrideProvider().useFactory() with injected dependencies', async () => {
    @Module({ providers: [ConfigService, UsersService] })
    class Wrapped {}

    // The factory's own dependency is contributed by the root testing module.
    const moduleRef = await Test.createTestingModule({
      imports: [Wrapped],
      providers: [{ provide: 'SUFFIX', useValue: 'mock' }]
    })
      .overrideProvider(ConfigService)
      .useFactory((suffix: string) => ({ getName: () => `factory-${suffix}` }), ['SUFFIX'])
      .compile();

    expect((await moduleRef.get(UsersService)).name()).toBe('factory-mock');
  });
});
