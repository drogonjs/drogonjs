import { describe, expect, it } from 'bun:test';
import {
  ConfigurableModuleBuilder,
  Inject,
  Injectable,
  Module,
  Optional,
  Reflector,
  Scope,
  SetMetadata,
  forwardRef,
  type BeforeApplicationShutdown,
  type OnApplicationShutdown
} from '@drogonjs/common';
import { ApplicationContext, Container, ContextId, ModuleRef, pathMatches } from '@drogonjs/core';

describe('forwardRef', () => {
  it('lets two singletons depend on each other', async () => {
    // Typed loosely: emitted metadata would read `Egg` before its declaration.
    // Across files the binding is merely undefined, which forwardRef covers.
    @Injectable()
    class Chicken {
      constructor(@Inject(forwardRef(() => Egg)) readonly egg: any) {}
      name = 'chicken';
    }

    @Injectable()
    class Egg {
      constructor(@Inject(forwardRef(() => Chicken)) readonly chicken: Chicken) {}
      name = 'egg';
      hatch() {
        return this.chicken.name;
      }
    }

    const container = new Container().registerMany([Chicken, Egg]);
    const chicken = await container.resolve(Chicken);
    const egg = await container.resolve(Egg);
    expect(chicken.egg).toBe(egg);
    expect(egg.chicken).toBe(chicken);
    expect(egg.hatch()).toBe('chicken');
    expect(chicken).toBeInstanceOf(Chicken);
  });

  it('still rejects a cycle without forwardRef, pointing at it', async () => {
    @Injectable()
    class A {
      constructor(@Inject('B') readonly b: unknown) {}
    }
    @Injectable()
    class B {
      constructor(readonly a: A) {}
    }
    const container = new Container().registerMany([A, { provide: 'B', useClass: B }]);
    await expect(container.resolve(A)).rejects.toThrow('forwardRef');
  });

  it('resolves module imports wrapped in forwardRef', async () => {
    @Injectable()
    class Shared {}

    @Module({ imports: [forwardRef(() => SharedModule)], providers: [] })
    class AppModule {}

    @Module({ providers: [Shared], exports: [Shared] })
    class SharedModule {}

    const app = await ApplicationContext.create(AppModule);
    expect(await app.get(Shared)).toBeInstanceOf(Shared);
  });
});

describe('property injection and factory dependencies', () => {
  it('injects decorated properties, by type or token, optionally', async () => {
    @Injectable()
    class Clock {
      now = () => 1;
    }

    @Injectable()
    class Service {
      @Inject() clock!: Clock;
      @Inject('PREFIX') prefix!: string;
      @Optional() @Inject('MISSING') missing?: string;
    }

    const container = new Container().registerMany([Clock, Service, { provide: 'PREFIX', useValue: '>' }]);
    const service = await container.resolve(Service);
    expect(service.clock).toBeInstanceOf(Clock);
    expect(service.prefix).toBe('>');
    expect(service.missing).toBeUndefined();
  });

  it('passes undefined for a missing optional factory dependency', async () => {
    const container = new Container().registerMany([
      { provide: 'A', useValue: 'a' },
      { provide: 'RESULT', useFactory: (a: string, b?: string) => [a, b], inject: ['A', { token: 'B', optional: true }] }
    ]);
    expect(await container.resolve('RESULT')).toEqual(['a', undefined]);
  });
});

describe('ModuleRef', () => {
  @Injectable()
  class Private {}

  @Injectable({ scope: Scope.TRANSIENT })
  class Fresh {}

  @Module({ providers: [Private] })
  class OtherModule {}

  @Injectable()
  class Locator {
    constructor(readonly moduleRef: ModuleRef) {}
  }

  @Injectable()
  class Built {
    constructor(readonly locator: Locator) {}
  }

  @Module({ imports: [OtherModule], providers: [Locator, Fresh] })
  class AppModule {}

  it('gets singletons synchronously, scoped to the module unless strict is off', async () => {
    const app = await ApplicationContext.create(AppModule);
    const { moduleRef } = await app.get(Locator);
    expect(moduleRef.get(Locator)).toBe(await app.get(Locator));
    expect(() => moduleRef.get(Private)).toThrow('strict');
    expect(moduleRef.get(Private, { strict: false })).toBeInstanceOf(Private);
    expect(() => moduleRef.get(Fresh)).toThrow('resolve()');
  });

  it('resolves transient providers and creates unregistered classes', async () => {
    const app = await ApplicationContext.create(AppModule);
    const { moduleRef } = await app.get(Locator);
    const [first, second] = await Promise.all([moduleRef.resolve(Fresh), moduleRef.resolve(Fresh)]);
    expect(first).not.toBe(second);
    const built = await moduleRef.create(Built);
    expect(built.locator).toBe(await app.get(Locator));
    await expect(moduleRef.resolve(Fresh, new ContextId())).resolves.toBeInstanceOf(Fresh);
  });
});

describe('Reflector', () => {
  it('overrides and merges metadata across targets', () => {
    const Tags = Reflector.createDecorator<string[]>({ key: 'tags' });

    @Tags(['class'])
    @SetMetadata('settings', { a: 1 })
    class Target {
      @Tags(['method'])
      @SetMetadata('settings', { b: 2 })
      handler() {}
    }

    const reflector = new Reflector();
    const targets = [Target.prototype.handler, Target];
    expect(reflector.get(Tags, Target)).toEqual(['class']);
    expect(reflector.getAllAndOverride(Tags, targets)).toEqual(['method']);
    expect(reflector.getAllAndMerge(Tags, targets)).toEqual(['method', 'class']);
    expect(reflector.getAllAndMerge('settings', targets)).toEqual({ a: 1, b: 2 });
    expect(reflector.getAllAndOverride('absent', targets)).toBeUndefined();
  });
});

describe('ConfigurableModuleBuilder', () => {
  interface GreetingOptions {
    greeting: string;
  }

  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } = new ConfigurableModuleBuilder<GreetingOptions>({ moduleName: 'Greeting' })
    .setClassMethodName('forRoot')
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build();

  @Injectable()
  class Greeter {
    constructor(@Inject(MODULE_OPTIONS_TOKEN) readonly options: GreetingOptions) {}
  }

  @Module({ providers: [Greeter], exports: [Greeter] })
  class GreetingModule extends ConfigurableModuleClass {}

  it('provides the options given to forRoot, minus the extras', async () => {
    const app = await ApplicationContext.create(GreetingModule.forRoot({ greeting: 'hi', isGlobal: true }));
    expect((await app.get(Greeter)).options).toEqual({ greeting: 'hi' });
    expect(GreetingModule.forRoot({ greeting: 'x', isGlobal: true }).global).toBe(true);
  });

  it('builds options asynchronously from a factory or a class', async () => {
    const viaFactory = await ApplicationContext.create(
      GreetingModule.forRootAsync({
        useFactory: async (punctuation: string) => ({ greeting: `hello${punctuation}` }),
        inject: ['PUNCT'],
        extraProviders: [{ provide: 'PUNCT', useValue: '!' }]
      })
    );
    expect((await viaFactory.get(Greeter)).options).toEqual({ greeting: 'hello!' });

    @Injectable()
    class OptionsFactory {
      create() {
        return { greeting: 'from class' };
      }
    }
    const viaClass = await ApplicationContext.create(GreetingModule.forRootAsync({ useClass: OptionsFactory }));
    expect((await viaClass.get(Greeter)).options.greeting).toBe('from class');
  });
});

describe('shutdown hooks', () => {
  it('runs beforeApplicationShutdown between onModuleDestroy and onApplicationShutdown', async () => {
    const calls: string[] = [];

    @Injectable()
    class Resource implements BeforeApplicationShutdown, OnApplicationShutdown {
      onModuleDestroy() {
        calls.push('destroy');
      }
      beforeApplicationShutdown(signal?: string) {
        calls.push(`before:${signal}`);
      }
      onApplicationShutdown(signal?: string) {
        calls.push(`shutdown:${signal}`);
      }
    }

    @Module({ providers: [Resource] })
    class AppModule {}

    const app = await ApplicationContext.create(AppModule);
    await app.close('SIGTERM');
    expect(calls).toEqual(['destroy', 'before:SIGTERM', 'shutdown:SIGTERM']);
  });
});

describe('middleware path patterns', () => {
  it('matches declared route paths', () => {
    expect(pathMatches('*', '/anything/at/all')).toBe(true);
    expect(pathMatches('cats', '/cats')).toBe(true);
    expect(pathMatches('cats', '/cats/:id')).toBe(false);
    expect(pathMatches('cats/*', '/cats/:id')).toBe(true);
    expect(pathMatches('cats/*', '/cats')).toBe(true);
    expect(pathMatches('cats/:id', '/cats/:id')).toBe(true);
    expect(pathMatches('cats/{*rest}', '/cats/a/b')).toBe(true);
    expect(pathMatches('dogs/*', '/cats/:id')).toBe(false);
  });
});
