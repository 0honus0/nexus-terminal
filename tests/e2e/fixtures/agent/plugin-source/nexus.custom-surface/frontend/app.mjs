import { connectNexusPlugin } from '/sdk/frontend-v1.mjs';

const status = document.querySelector('[data-testid="custom-sdk-status"]');
let nexus;
try {
	nexus = await connectNexusPlugin();
	const [app, definitions] = await Promise.all([
		nexus.request({ method: 'host.appInfo', params: {} }),
		nexus.request({ method: 'agent.definitions.list', params: {} }),
	]);
	if (app.method !== 'host.appInfo' || definitions.method !== 'agent.definitions.list')
		throw new Error('Unexpected SDK result');
	const definition = definitions.value.find((candidate) => candidate.id === app.value.definitionId);
	if (!definition) throw new Error('Custom definition is missing');
	status.textContent = `ready:${app.value.appId}:${definition.id}`;
} catch {
	status.textContent = 'error:SDK initialization failed';
}
