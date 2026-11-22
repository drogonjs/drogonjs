import { describeAdapterFeatures } from '../../core/test/feature-suite';
import { createHonoApplication } from '../src/index';

describeAdapterFeatures('@drogonjs/platform-hono', async (root, options) => {
  const { app } = await createHonoApplication(root, options);
  return (path, init) => Promise.resolve(app.request(path, init));
});
