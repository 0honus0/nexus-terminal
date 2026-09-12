import { connectNexusPlugin } from '/sdk/frontend-v1.mjs';

const status = document.querySelector('[data-testid="custom-sdk-status"]');

try {
  const nexus = await connectNexusPlugin();
  const [app, definitions] = await Promise.all([nexus.host.appInfo(), nexus.agent.definitions.list()]);
  const definition = definitions.find((candidate) => candidate.id === 'custom.default');
  if (!definition) throw new Error('CUSTOM_DEFINITION_MISSING');
  status.textContent = `ready:${app.appId}:${definition.id}`;
} catch (error) {
  status.textContent = `error:${error instanceof Error ? error.message : String(error)}`;
}
