import { describe, expect, it } from 'bun:test';
import { Global, Injectable, Module } from '@drogonjs/common';
import { ApplicationContext } from '../src/index';

describe('ApplicationContext lifecycle', () => {
  it('gives each module that provides a class its own instance, initialised once', async () => {
    const inited: object[] = [];

    @Injectable()
    class Shared {
      onModuleInit() {
        inited.push(this);
      }
    }

    @Module({ providers: [Shared] })
    class Left {}
    @Module({ providers: [Shared] })
    class Right {}
    @Module({ imports: [Left, Right] })
    class Root {}

    const app = await ApplicationContext.create(Root);
    const [left, right] = app.getModules().filter(ref => ref.module.type !== Root);

    // Modules are encapsulated: listing a provider creates it in that module.
    expect(inited).toHaveLength(2);
    expect(new Set(inited).size).toBe(2);
    expect(await left!.container.resolve(Shared)).not.toBe(await right!.container.resolve(Shared));
  });

  it('runs onModuleInit once for a singleton reachable through several tokens', async () => {
    let inits = 0;

    @Injectable()
    class Shared {
      onModuleInit() {
        inits++;
      }
    }

    @Module({ providers: [Shared, { provide: 'ALIAS', useExisting: Shared }] })
    class Root {}

    const app = await ApplicationContext.create(Root);

    expect(inits).toBe(1);
    expect(await app.get<Shared>('ALIAS')).toBe(await app.get(Shared));
  });

  it('runs destroy hooks once even if close is called repeatedly', async () => {
    let destroys = 0;
    let shutdowns = 0;

    @Injectable()
    class Service {
      onModuleDestroy() {
        destroys++;
      }
      onApplicationShutdown() {
        shutdowns++;
      }
    }

    @Module({ providers: [Service] })
    class Root {}

    const app = await ApplicationContext.create(Root);
    await app.close();
    await app.close();

    expect(destroys).toBe(1);
    expect(shutdowns).toBe(1);
  });

  it('passes the signal through to onApplicationShutdown', async () => {
    let received: string | undefined;

    @Injectable()
    class Service {
      onApplicationShutdown(signal?: string) {
        received = signal;
      }
    }

    @Module({ providers: [Service] })
    class Root {}

    await (await ApplicationContext.create(Root)).close('SIGTERM');

    expect(received).toBe('SIGTERM');
  });

  it('tears instances down in reverse construction order', async () => {
    const order: string[] = [];

    @Injectable()
    class First {
      onModuleDestroy() {
        order.push('first');
      }
    }
    @Injectable()
    class Second {
      constructor(public first: First) {}
      onModuleDestroy() {
        order.push('second');
      }
    }

    @Module({ providers: [First, Second] })
    class Root {}

    await (await ApplicationContext.create(Root)).close();

    expect(order).toEqual(['second', 'first']);
  });

  it('tears a dependency down after its dependent even when it is declared later', async () => {
    const order: string[] = [];

    @Injectable()
    class First {
      onModuleDestroy() {
        order.push('first');
      }
    }
    @Injectable()
    class Second {
      constructor(public first: First) {}
      onModuleDestroy() {
        order.push('second');
      }
    }

    @Module({ providers: [Second, First] })
    class Root {}

    await (await ApplicationContext.create(Root)).close();

    expect(order).toEqual(['second', 'first']);
  });

  it('closes on a shutdown signal and re-raises it', async () => {
    let received: string | undefined;

    @Injectable()
    class Service {
      onApplicationShutdown(signal?: string) {
        received = signal;
      }
    }

    @Module({ providers: [Service] })
    class Root {}

    const app = (await ApplicationContext.create(Root)).enableShutdownHooks(['SIGUSR2']);
    const realKill = process.kill;
    const killed = new Promise<string>(resolve => {
      process.kill = ((_pid: number, signal: string) => {
        resolve(signal);
        return true;
      }) as typeof process.kill;
    });

    try {
      process.emit('SIGUSR2', 'SIGUSR2');
      expect(await killed).toBe('SIGUSR2');
    } finally {
      process.kill = realKill;
    }

    expect(received).toBe('SIGUSR2');
    expect(process.listenerCount('SIGUSR2')).toBe(0);
    await app.close();
  });

  it('removes its signal listeners when closed directly', async () => {
    @Module({})
    class Root {}

    const before = process.listenerCount('SIGUSR2');
    const app = (await ApplicationContext.create(Root)).enableShutdownHooks(['SIGUSR2']);
    expect(process.listenerCount('SIGUSR2')).toBe(before + 1);

    await app.close();

    expect(process.listenerCount('SIGUSR2')).toBe(before);
  });

  it('resolves a provider that depends on a token contributed by a later module', async () => {
    @Injectable()
    class Consumer {
      constructor(public value: unknown) {}
    }

    // Consumer's module is imported before the global module that supplies the
    // token, so the whole graph has to be registered before anything is
    // instantiated.
    @Module({ providers: [{ provide: 'CONSUMER', useFactory: (v: unknown) => new Consumer(v), inject: ['LATE'] }] })
    class Early {}
    @Global()
    @Module({ providers: [{ provide: 'LATE', useValue: 'supplied' }], exports: ['LATE'] })
    class Late {}
    @Module({ imports: [Early, Late] })
    class Root {}

    const app = await ApplicationContext.create(Root);

    expect((await app.get<Consumer>('CONSUMER')).value).toBe('supplied');
  });

  it('compiles a module reached through several import paths only once', async () => {
    @Injectable()
    class Shared {}

    @Module({ providers: [Shared], exports: [Shared] })
    class SharedModule {}
    @Module({ imports: [SharedModule] })
    class Left {}
    @Module({ imports: [SharedModule] })
    class Right {}
    @Module({ imports: [Left, Right, SharedModule] })
    class Root {}

    const app = await ApplicationContext.create(Root);
    const left = app.root.imports.find(m => m.type === Left)!;
    const right = app.root.imports.find(m => m.type === Right)!;

    expect(left.imports[0]).toBe(right.imports[0]);
  });
});
