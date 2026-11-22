import { describeAdapterFeatures } from '../../core/test/feature-suite';
import { createElysiaApplication } from '../src/index';

describeAdapterFeatures('@drogonjs/platform-elysia', async (root, options) => {
  const { app } = await createElysiaApplication(root, options);
  return (path, init) => app.handle(new Request(`http://localhost${path}`, init));
});
