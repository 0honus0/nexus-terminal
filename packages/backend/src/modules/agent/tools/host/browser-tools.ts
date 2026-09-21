import type { ArtifactService } from '../../ai/artifact.service';
import type { BrowserGatewayPort } from '../../ai/integrations.types';
import type { AgentTool } from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import type { AgentSettingsService } from '../../host/agent-settings.service';
import type { AgentWorkspaceRepositoryPort } from '../../workspace-runtime/workspace-runtime.repository.port';
import { createBrowserInteractionTools } from './browser/browser-interaction-tools';
import { createBrowserLifecycleTools } from './browser/browser-lifecycle-tools';
import { createBrowserObservationTools } from './browser/browser-observation-tools';
import { BrowserSessionBindingAuthority } from './browser/browser-session-binding-authority';
import { createBrowserTransferTools } from './browser/browser-transfer-tools';

const BROWSER_TOOL_ORDER = [
  'browser_create_session',
  'browser_snapshot',
  'browser_screenshot',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_press',
  'browser_back',
  'browser_select',
  'browser_wait',
  'browser_console',
  'browser_upload',
  'browser_download',
  'browser_close',
] as const;

export const createBrowserTools = (
  repository: AgentWorkspaceRepositoryPort,
  settings: AgentSettingsService,
  gateway: BrowserGatewayPort,
  cryptoHash: CryptoHashPort,
  artifacts?: ArtifactService,
): AgentTool[] => {
  const authority = new BrowserSessionBindingAuthority(repository, settings, gateway, cryptoHash);
  const tools = [
    ...createBrowserLifecycleTools(authority, gateway),
    ...createBrowserObservationTools(authority, gateway, artifacts),
    ...createBrowserInteractionTools(authority, gateway),
    ...createBrowserTransferTools(authority, gateway, artifacts),
  ];
  const byName = new Map(tools.map((tool) => [tool.descriptor.name, tool]));
  if (tools.length !== BROWSER_TOOL_ORDER.length || byName.size !== tools.length) {
    throw new Error('BROWSER_TOOL_CATALOG_INVALID');
  }
  return BROWSER_TOOL_ORDER.map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`BROWSER_TOOL_MISSING:${name}`);
    return tool;
  });
};
