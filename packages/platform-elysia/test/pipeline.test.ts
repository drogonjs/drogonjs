import { describeAdapterPipeline } from '../../core/test/adapter-suite';
import { createElysiaApplication } from '../src/index';

describeAdapterPipeline('@drogonjs/platform-elysia', async (root, options) => {
  const { app } = await createElysiaApplication(root, options);
  return (path, init) => app.handle(new Request(`http://localhost${path}`, init));
});
