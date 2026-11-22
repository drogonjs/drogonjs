import { describe, expect, it } from 'bun:test';
import { Global, Injectable, Module, type DynamicModule } from '@drogonjs/common';
import { ApplicationContext } from '../src/index';

describe('module encapsulation', () => {
  it('does not let a module inject a provider another module keeps private', async () => {
    @Injectable()
    class Hidden {}
    @Module({ providers: [Hidden] })
    class InnerModule {}

    @Injectable()
    class Outer {
      constructor(public hidden: Hidden) {}
    }
    @Module({ imports: [InnerModule], providers: [Outer] })
    class Root {}

    await expect(ApplicationContext.create(Root)).rejects.toThrow('Unknown provider: Hidden (needed by Outer) in Root');
  });

  it('injects a provider the imported module exports, sharing its instance', async () => {
    @Injectable()
    class Shared {}
    @Module({ providers: [Shared], exports: [Shared] })
    class SharedModule {}

    @Injectable()
    class Consumer {
      constructor(public shared: Shared) {}
    }
    @Module({ imports: [SharedModule], providers: [Consumer] })
    class Root {}

    const app = await ApplicationContext.create(Root);

    expect((await app.get(Consumer)).shared).toBe(await app.get(Shared));
  });

  it('follows a module re-exported by the module in between', async () => {
    @Injectable()
    class Deep {}
    @Module({ providers: [Deep], exports: [Deep] })
    class DeepModule {}
    @Module({ imports: [DeepModule], exports: [DeepModule] })
    class MiddleModule {}

    @Injectable()
    class Consumer {
      constructor(public deep: Deep) {}
    }
    @Module({ imports: [MiddleModule], providers: [Consumer] })
    class Root {}

    expect((await (await ApplicationContext.create(Root)).get(Consumer)).deep).toBeInstanceOf(Deep);
  });

  it('does not pass imports through a module that does not re-export them', async () => {
    @Injectable()
    class Deep {}
    @Module({ providers: [Deep], exports: [Deep] })
    class DeepModule {}
    @Module({ imports: [DeepModule] })
    class MiddleModule {}

    @Injectable()
    class Consumer {
      constructor(public deep: Deep) {}
    }
    @Module({ imports: [MiddleModule], providers: [Consumer] })
    class Root {}

    await expect(ApplicationContext.create(Root)).rejects.toThrow('Unknown provider: Deep');
  });

  it('makes the exports of a global module available without importing it', async () => {
    @Injectable()
    class Config {}
    @Global()
    @Module({ providers: [Config], exports: [Config] })
    class ConfigModule {}

    @Injectable()
    class Consumer {
      constructor(public config: Config) {}
    }
    @Module({ providers: [Consumer] })
    class FeatureModule {}
    @Module({ imports: [ConfigModule, FeatureModule] })
    class Root {}

    expect((await (await ApplicationContext.create(Root)).get(Consumer)).config).toBeInstanceOf(Config);
  });

  it('keeps equal tokens in different modules apart', async () => {
    @Module({ providers: [{ provide: 'NAME', useValue: 'left' }, { provide: 'LEFT', useFactory: (n: string) => n, inject: ['NAME'] }], exports: ['LEFT'] })
    class Left {}
    @Module({ providers: [{ provide: 'NAME', useValue: 'right' }, { provide: 'RIGHT', useFactory: (n: string) => n, inject: ['NAME'] }], exports: ['RIGHT'] })
    class Right {}
    @Module({ imports: [Left, Right] })
    class Root {}

    const app = await ApplicationContext.create(Root);

    expect(await app.get<string>('LEFT')).toBe('left');
    expect(await app.get<string>('RIGHT')).toBe('right');
  });

  it('rejects exporting a token the module neither provides nor imports', async () => {
    @Module({ exports: ['NOWHERE'] })
    class Root {}

    await expect(ApplicationContext.create(Root)).rejects.toThrow('Root exports NOWHERE, but neither provides it');
  });

  it('resolves across a circular import with one instance per module', async () => {
    @Injectable()
    class A {}
    @Injectable()
    class B {}

    @Module({ imports: [], providers: [A], exports: [A] })
    class ModuleA {}
    @Module({ imports: [ModuleA], providers: [B], exports: [B] })
    class ModuleB {}
    // Closes the loop after both classes exist.
    (Reflect.getOwnMetadata(Symbol.for('drogonjs:module'), ModuleA).imports as unknown[]).push(ModuleB);

    @Module({ imports: [ModuleA] })
    class Root {}

    const app = await ApplicationContext.create(Root);
    const moduleA = app.root.imports[0]!;

    expect(moduleA.imports[0]!.imports[0]).toBe(moduleA);
    expect(app.getModules().filter(ref => ref.module.type === ModuleA)).toHaveLength(1);
  });

  it('only searches beyond the root module when not strict', async () => {
    @Module({ providers: [{ provide: 'INNER', useValue: 'found' }] })
    class Inner {}
    @Module({ imports: [Inner] })
    class Root {}

    const app = await ApplicationContext.create(Root);

    expect(await app.get<string>('INNER')).toBe('found');
    await expect(app.get('INNER', { strict: true })).rejects.toThrow('Unknown provider: INNER');
  });

  it('gives two registrations of a dynamic module separate providers', async () => {
    @Module({})
    class ConfigModule {
      static register(value: string): DynamicModule {
        return { module: ConfigModule, providers: [{ provide: 'VALUE', useValue: value }], exports: ['VALUE'] };
      }
    }

    @Module({ imports: [ConfigModule.register('a')], providers: [{ provide: 'A', useFactory: (v: string) => v, inject: ['VALUE'] }], exports: ['A'] })
    class FeatureA {}
    @Module({ imports: [ConfigModule.register('b')], providers: [{ provide: 'B', useFactory: (v: string) => v, inject: ['VALUE'] }], exports: ['B'] })
    class FeatureB {}
    @Module({ imports: [FeatureA, FeatureB] })
    class Root {}

    const app = await ApplicationContext.create(Root);

    expect(await app.get<string>('A')).toBe('a');
    expect(await app.get<string>('B')).toBe('b');
  });

  it('applies overrides in whichever module declares the token', async () => {
    @Module({ providers: [{ provide: 'DB', useValue: 'real' }], exports: ['DB'] })
    class DbModule {}
    @Module({ imports: [DbModule] })
    class Root {}

    const app = await ApplicationContext.create(Root, { overrides: [{ provide: 'DB', useValue: 'fake' }] });

    expect(await app.get<string>('DB')).toBe('fake');
  });
});
