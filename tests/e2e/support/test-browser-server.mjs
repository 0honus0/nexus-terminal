import { chromium } from '@playwright/test';
import http from 'node:http';

// Dedicated Chromium owned by this fixture, never the user's browser.
const cdpPort = Number(process.env.NEXUS_E2E_BROWSER_CDP_PORT || 29094);
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${cdpPort}`] });
const session = await browser.newBrowserCDPSession();
const server = http.createServer(async (request, response) => {
  try {
    if (request.url !== '/contexts') {
      response.writeHead(404);
      response.end();
      return;
    }
    const contexts = await session.send('Target.getBrowserContexts');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(contexts));
  } catch {
    response.writeHead(500);
    response.end();
  }
});
server.listen(Number(process.env.NEXUS_E2E_BROWSER_CONTROL_PORT || 29093), '127.0.0.1');
const shutdown = async () => {
  server.close();
  await browser.close();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
