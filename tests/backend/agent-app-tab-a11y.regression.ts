import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), '../..');
const source = readFileSync(path.join(root, 'packages/frontend/src/features/agent/host/AgentHubWindow.vue'), 'utf8');

assert(!source.includes('role="button"'), 'AgentHubWindow must not emulate native buttons with role=button');
assert(!source.includes('@keydown.enter.stop="closeAppTab'), 'native close button must own Enter/Space activation');
assert(
  source.includes('<!-- 关闭 Tab：与切换按钮并列，使用原生 button 的 Enter / Space 语义。 -->'),
  'tab close control must remain a sibling native button',
);
assert(
  source.includes('@click.stop="closeAppTab(app.id, $event)"'),
  'close button must keep click propagation isolated from tab switching',
);
assert(
  source.includes(':aria-label="$t(\'agent.hub.closeApp\', { app: app.displayName })"'),
  'close button must keep an accessible name',
);

const appTabStart = source.indexOf('v-for="app in displayedApps"');
const appTabEnd = source.indexOf('<!-- 新建 App 按钮 -->', appTabStart);
assert(appTabStart >= 0 && appTabEnd > appTabStart, 'app tab template must remain discoverable');
const appTabMarkup = source.slice(appTabStart, appTabEnd);
assert(appTabMarkup.includes('<button'), 'app tab must use native buttons');
assert(
  (appTabMarkup.match(/<button/g) ?? []).length === 2,
  'each rendered app tab template must define sibling switch and close native buttons',
);
assert(
  appTabMarkup.indexOf('</button>') < appTabMarkup.lastIndexOf('<button'),
  'close button must start only after the switch button has closed',
);

process.stdout.write('agent app tab accessibility regression: PASS\n');
