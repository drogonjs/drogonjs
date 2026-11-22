import { describe, expect, it } from 'bun:test';
import { Inject, Injectable, Optional, REQUEST, Scope } from '@drogonjs/common';
import { Container, ContextId } from '../src/index';

describe('Container resolution', () => {
  it('shares one instance between dependency branches resolved concurrently', async () => {
    let constructed = 0;

    @Injectable()
    class Shared {
      constructor() {
        constructed++;
      }
    }
    @Injectable()
    class Left {
      constructor(public shared: Shared) {}
    }
    @Injectable()
    class Right {
      constructor(public shared: Shared) {}
    }

    const container = new Container();
    container.registerMany([Shared, Left, Right]);
    container.register({
      provide: 'PAIR',
      useFactory: (left: Left, right: Right) => ({ left, right }),
      inject: [Left, Right]
    });

    const pair = await container.resolve<{ left: Left; right: Right }>('PAIR');

    expect(constructed).toBe(1);
    expect(pair.left.shared).toBe(pair.right.shared);
  });

  it('caches singletons that resolve to undefined', async () => {
    let calls = 0;
    const container = new Container();
    container.register({
      provide: 'MAYBE',
      useFactory: () => {
        calls++;
        return undefined;
      }
    });

    await container.resolve('MAYBE');
    await container.resolve('MAYBE');

    expect(calls).toBe(1);
  });

  it('still creates a new instance per resolution for transient providers', async () => {
    @Injectable({ scope: Scope.TRANSIENT })
    class Transient {}

    const container = new Container();
    container.register(Transient);

    expect(await container.resolve(Transient)).not.toBe(await container.resolve(Transient));
  });

  it('reports the full path of a circular dependency', async () => {
    const container = new Container();
    container.register({ provide: 'A', useFactory: (b: unknown) => ({ b }), inject: ['B'] });
    container.register({ provide: 'B', useFactory: (c: unknown) => ({ c }), inject: ['C'] });
    container.register({ provide: 'C', useFactory: (a: unknown) => ({ a }), inject: ['A'] });

    await expect(container.resolve('A')).rejects.toThrow('Circular dependency detected: A -> B -> C -> A');
  });

  it('detects a provider that depends on itself', async () => {
    const container = new Container();
    container.register({ provide: 'SELF', useFactory: (s: unknown) => s, inject: ['SELF'] });

    await expect(container.resolve('SELF')).rejects.toThrow('Circular dependency detected: SELF -> SELF');
  });

  it('allows a retry after a failed resolution', async () => {
    let attempts = 0;
    const container = new Container();
    container.register({
      provide: 'FLAKY',
      useFactory: () => {
        if (++attempts === 1) throw new Error('boom');
        return 'recovered';
      }
    });

    await expect(container.resolve('FLAKY')).rejects.toThrow('boom');
    expect(await container.resolve<string>('FLAKY')).toBe('recovered');
  });

  it('keeps the existing instance when the same provider is registered twice', async () => {
    @Injectable()
    class Service {}

    const container = new Container();
    container.register(Service);
    const first = await container.resolve(Service);
    container.register(Service);

    expect(await container.resolve(Service)).toBe(first);
  });

  it('replaces the binding when a token is re-registered with a different provider', async () => {
    @Injectable()
    class Service {
      name = 'real';
    }

    const container = new Container();
    container.register(Service);
    await container.resolve(Service);
    container.register({ provide: Service, useValue: { name: 'override' } });

    expect((await container.resolve(Service)).name).toBe('override');
  });

  it('falls back to undefined for optional dependencies that cannot be resolved', async () => {
    @Injectable()
    class Service {
      constructor(@Optional() @Inject('MISSING') public maybe?: string) {}
    }

    const container = new Container();
    container.register(Service);

    expect((await container.resolve(Service)).maybe).toBeUndefined();
  });

  it('throws a named error for an unknown token', async () => {
    await expect(new Container().resolve('NOPE')).rejects.toThrow('Unknown provider: NOPE');
  });

  it('resolves through a parent container', async () => {
    @Injectable()
    class Service {}

    const parent = new Container();
    parent.register(Service);
    const child = parent.createChild();

    expect(await child.resolve(Service)).toBe(await parent.resolve(Service));
  });

  it('does not construct a class that was never registered', async () => {
    @Injectable()
    class Unregistered {}

    await expect(new Container().resolve(Unregistered)).rejects.toThrow('Unknown provider: Unregistered');
  });

  it('names the dependent when a dependency is missing', async () => {
    @Injectable()
    class Missing {}
    @Injectable()
    class Consumer {
      constructor(public missing: Missing) {}
    }

    const container = new Container(undefined, { name: 'UsersModule' });
    container.register(Consumer);

    await expect(container.resolve(Consumer)).rejects.toThrow(
      'Unknown provider: Missing (needed by Consumer) in UsersModule'
    );
  });

  it('refuses to inject a primitive-typed parameter without @Inject', async () => {
    @Injectable()
    class Service {
      constructor(public name: string) {}
    }

    const container = new Container();
    container.register(Service);

    await expect(container.resolve(Service)).rejects.toThrow('Cannot resolve parameter #0 of Service');
  });

  it('leaves an optional primitive-typed parameter undefined', async () => {
    @Injectable()
    class Service {
      constructor(@Optional() public name?: string) {}
    }

    const container = new Container();
    container.register(Service);

    expect((await container.resolve(Service)).name).toBeUndefined();
  });

  it('leaves an optional class dependency undefined when it is not registered', async () => {
    @Injectable()
    class Absent {}
    @Injectable()
    class Service {
      constructor(@Optional() public absent?: Absent) {}
    }

    const container = new Container();
    container.register(Service);

    expect((await container.resolve(Service)).absent).toBeUndefined();
  });

  it('still reports a failure inside a registered optional dependency', async () => {
    @Injectable()
    class Broken {
      constructor() {
        throw new Error('broken constructor');
      }
    }
    @Injectable()
    class Service {
      constructor(@Optional() public broken?: Broken) {}
    }

    const container = new Container();
    container.registerMany([Broken, Service]);

    await expect(container.resolve(Service)).rejects.toThrow('broken constructor');
  });

  describe('request scope', () => {
    @Injectable({ scope: Scope.REQUEST })
    class PerRequest {
      constructor(@Inject(REQUEST) public request: unknown) {}
    }
    @Injectable()
    class DependsOnRequest {
      constructor(public perRequest: PerRequest) {}
    }
    @Injectable()
    class Static {}

    const create = () => new Container().registerMany([PerRequest, DependsOnRequest, Static]);

    it('requires a ContextId', async () => {
      await expect(create().resolve(PerRequest)).rejects.toThrow('PerRequest is request-scoped');
    });

    it('shares an instance within a context and not across contexts', async () => {
      const container = create();
      const first = new ContextId('first');
      const second = new ContextId('second');

      const a = await container.resolve(PerRequest, first);
      expect(await container.resolve(PerRequest, first)).toBe(a);
      expect(await container.resolve(PerRequest, second)).not.toBe(a);
      expect(a.request).toBe('first');
    });

    it('makes consumers of a request-scoped provider request-scoped too', async () => {
      const container = create();

      expect(container.isRequestScoped(DependsOnRequest)).toBe(true);
      expect(container.isStatic(Static)).toBe(true);
      await expect(container.resolve(DependsOnRequest)).rejects.toThrow('request-scoped');

      const context = new ContextId('req');
      const consumer = await container.resolve(DependsOnRequest, context);
      expect(consumer.perRequest).toBe(await container.resolve(PerRequest, context));
    });

    it('rejects REQUEST outside a request', async () => {
      await expect(new Container().resolve(REQUEST)).rejects.toThrow('REQUEST can only be injected');
    });
  });
});
