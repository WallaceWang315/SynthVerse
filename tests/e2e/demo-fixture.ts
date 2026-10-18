import { test as base } from '@playwright/test';
import { createApiServer } from '../../services/api/server';

// Use an isolated API instance, never the developer's configured provider/key.
export const test = base.extend<{ demoRouting: void }, { demoApi: string }>({
  demoApi: [async ({}, use) => {
    const server = createApiServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try { await use(`http://127.0.0.1:${(server.address() as { port: number }).port}`); }
    finally { await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); }
  }, { scope: 'worker' }],
  demoRouting: [async ({ page, demoApi }, use) => {
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: demoApi + url.pathname + url.search });
      await route.fulfill({ response });
    });
    await use();
  }, { auto: true }],
});
