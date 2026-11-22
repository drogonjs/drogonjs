import { describe, expect, it } from 'bun:test';
import {
  Inject,
  Injectable,
  Module,
  Scope,
  type OnApplicationBootstrap,
  type OnModuleInit
} from '@drogonjs/common';
import { ApplicationContext, Container } from '../src/index';

@Injectable()
class ConfigService {
  value = 'ok';
}

@Injectable()
class UsersService {
  constructor(public readonly config: ConfigService) {}
}

@Injectable({ scope: Scope.TRANSIENT })
class RandomService {
  id = Math.random();
}

@Injectable()
class TokenConsumer {
  constructor(@Inject('TOKEN') public readonly value: string) {}
}

@Injectable()
class LifecycleService implements OnModuleInit, OnApplicationBootstrap {
  inited = false;
  bootstrapped = false;

  onModuleInit() {
    this.inited = true;
  }

  onApplicationBootstrap() {
    this.bootstrapped = true;
  }
}

@Module({
  providers: [
    ConfigService,
    UsersService,
    RandomService,
    LifecycleService,
    TokenConsumer,
    { provide: 'TOKEN', useValue: 'hello' }
  ]
})
class AppModule {}

describe('@drogonjs/core', () => {
  it('resolves class dependencies', async () => {
    const container = new Container();
    container.registerMany([ConfigService, UsersService]);
    const users = await container.resolve(UsersService);
    expect(users.config.value).toBe('ok');
  });

  it('supports transient providers', async () => {
    const container = new Container();
    container.register(RandomService);
    const a = await container.resolve(RandomService);
    const b = await container.resolve(RandomService);
    expect(a.id).not.toBe(b.id);
  });

  it('supports value injection tokens', async () => {
    const container = new Container();
    container.register({ provide: 'TOKEN', useValue: 'hello' });
    container.register(TokenConsumer);
    const consumer = await container.resolve(TokenConsumer);
    expect(consumer.value).toBe('hello');
  });

  it('runs lifecycle hooks during application bootstrap', async () => {
    const app = await ApplicationContext.create(AppModule);
    const service = await app.get(LifecycleService);
    expect(service.inited).toBe(true);
    expect(service.bootstrapped).toBe(true);
  });
});
