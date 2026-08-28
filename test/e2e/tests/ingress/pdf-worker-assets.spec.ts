import { expect, test } from '@playwright/test';

const productionHeaders = { Host: 'ssh.honus.top' };

test.describe('production PDF.js worker assets', () => {
  test('serves the PDF.js module worker with a JavaScript MIME type', async ({ request }) => {
    const indexResponse = await request.get('/', { headers: productionHeaders });
    expect(indexResponse.status()).toBe(200);
    const html = await indexResponse.text();

    const moduleScripts = [...html.matchAll(/<script[^>]+src="([^"?]+\.js)"/g)]
      .map((match) => match[1])
      .filter(Boolean);
    expect(moduleScripts.length).toBeGreaterThan(0);

    let workerPath = '';
    for (const scriptPath of moduleScripts) {
      const scriptResponse = await request.get(scriptPath, { headers: productionHeaders });
      if (!scriptResponse.ok()) continue;
      const source = await scriptResponse.text();
      const match = source.match(/\/assets\/pdf\.worker\.min-[A-Za-z0-9_-]+\.mjs/);
      if (match) {
        workerPath = match[0];
        break;
      }
    }

    expect(workerPath, 'built frontend should reference the PDF.js module worker asset').not.toBe('');

    const workerResponse = await request.get(workerPath, { headers: productionHeaders });
    expect(workerResponse.status()).toBe(200);
    const contentType = (workerResponse.headers()['content-type'] || '').split(';', 1)[0].trim();
    expect(['text/javascript', 'application/javascript']).toContain(contentType);
    expect(workerResponse.headers()['x-content-type-options']).toBe('nosniff');
  });
});
