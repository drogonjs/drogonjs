import { describe, expect, it } from 'bun:test';
import { ApiSchema, Controller, Module, Post } from '@drogonjs/common';
import { describeAdapterPipeline } from '../../core/test/adapter-suite';
import { createHonoApplication } from '../src/index';

describeAdapterPipeline('@drogonjs/platform-hono', async (root, options) => {
  const { app } = await createHonoApplication(root, options);
  return (path, init) => Promise.resolve(app.request(path, init));
});

describe('@drogonjs/platform-hono schemas', () => {
  it('refuses to mount a route whose @ApiSchema it cannot enforce', async () => {
    @Controller('/validated')
    class ValidatedController {
      @Post('/')
      @ApiSchema({ body: { type: 'object' } })
      create() {
        return {};
      }
    }

    @Module({ controllers: [ValidatedController] })
    class AppModule {}

    await expect(createHonoApplication(AppModule)).rejects.toThrow('declares @ApiSchema');
  });
});
