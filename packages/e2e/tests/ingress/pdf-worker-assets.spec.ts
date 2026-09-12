import { expect, test } from '@playwright/test';

const productionHeaders = { Host: 'ssh.honus.top' };
const jsAssetPattern = /(?:\/)?assets\/[A-Za-z0-9_.-]+\.js/g;
const workerAssetPattern = /(?:\/)?assets\/pdf\.worker\.min-[A-Za-z0-9_-]+\.mjs/;

const normalizeAssetPath = (value: string): string => (value.startsWith('/') ? value : `/${value}`);

test.describe('production PDF.js worker assets', () => {
  test('serves the PDF.js module worker with a JavaScript MIME type', async ({ request }) => {
    const indexResponse = await request.get('/', { headers: productionHeaders });
    expect(indexResponse.status()).toBe(200);
    const html = await indexResponse.text();

    const pending = [...html.matchAll(/<script[^>]+src="([^"?]+\.js)"/g)]
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value))
      .map(normalizeAssetPath);
    expect(pending.length).toBeGreaterThan(0);

    const visited = new Set<string>();
    let workerPath = '';
    while (pending.length && visited.size < 250 && !workerPath) {
      const scriptPath = pending.shift()!;
      if (visited.has(scriptPath)) continue;
      visited.add(scriptPath);

      const scriptResponse = await request.get(scriptPath, { headers: productionHeaders });
      if (!scriptResponse.ok()) continue;
      const source = await scriptResponse.text();
      const workerMatch = source.match(workerAssetPattern);
      if (workerMatch) {
        workerPath = normalizeAssetPath(workerMatch[0]);
        break;
      }

      for (const match of source.matchAll(jsAssetPattern)) {
        const next = normalizeAssetPath(match[0]);
        if (!visited.has(next)) pending.push(next);
      }
    }

    expect(workerPath, 'built frontend module graph should reference the PDF.js module worker asset').not.toBe('');

    const workerResponse = await request.get(workerPath, { headers: productionHeaders });
    expect(workerResponse.status()).toBe(200);
    const contentType = (workerResponse.headers()['content-type'] || '').split(';', 1)[0].trim();
    expect(['text/javascript', 'application/javascript']).toContain(contentType);
    expect(workerResponse.headers()['x-content-type-options']).toBe('nosniff');
  });
});
