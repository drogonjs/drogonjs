import { describe, expect, it } from 'bun:test';
import { Test } from '@drogonjs/testing';
import { AppController } from '../src/modules/app/app.controller';
import { AppModule } from '../src/modules/app/app.module';
import { AppService } from '../src/modules/app/app.service';

describe('AppController', () => {
  it('reports the service status', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const controller = await moduleRef.get(AppController);

    expect(controller.index().status).toBe('ok');

    await moduleRef.close();
  });

  it('greets by route parameter', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const controller = await moduleRef.get(AppController);

    expect(controller.hello('ada')).toEqual({ message: 'Hello, ada!' });

    await moduleRef.close();
  });

  it('swaps a provider for a stub', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppService)
      .useValue({
        info: () => ({ name: 'stub', status: 'ok', uptimeSeconds: 0 }),
        greet: (name: string) => ({ message: name })
      })
      .compile();

    const controller = await moduleRef.get(AppController);

    expect(controller.index().name).toBe('stub');

    await moduleRef.close();
  });
});
