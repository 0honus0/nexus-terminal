import { connectNexusPlugin } from '/sdk/frontend-v4.mjs';

const frontendStatus = document.querySelector('[data-testid="fullstack-frontend-status"]');
const backendStatus = document.querySelector('[data-testid="fullstack-backend-status"]');
const writeButton = document.querySelector('[data-testid="fullstack-write-storage"]');
const storageResult = document.querySelector('[data-testid="fullstack-storage-result"]');
let nexus;
try {
	nexus = await connectNexusPlugin();
	const app = await nexus.request({ method: 'host.appInfo', params: {} });
	if (app.method !== 'host.appInfo') throw new Error('Unexpected App response');
	frontendStatus.textContent = `frontend:ready:${app.value.appId}@${app.value.version}`;
 const threads = await nexus.request({method:'agent.threads.list',params:{after:null,limit:50}});
 if (threads.method !== 'agent.threads.list' || !threads.value.items.length) throw new Error('Backend probe thread missing');
 const runs = await nexus.request({method:'agent.runs.list',params:{threadId:threads.value.items[0].id,after:0,limit:100}});
 if (runs.method !== 'agent.runs.list') throw new Error('Backend probe runs missing');
 const run = runs.value.items.find((item) => item.status === 'completed');
 if (!run) throw new Error('Backend probe has not completed');
 const outputs = await nexus.request({method:'agent.runs.outputs',params:{runId:run.id}});
 if (outputs.method !== 'agent.runs.outputs' || outputs.value?.length !== 1) throw new Error('Backend output missing');
 const page = await nexus.request({method:'agent.content.read',params:{runId:run.id,reference:outputs.value[0],index:0}});
 if (page.method !== 'agent.content.read' || page.value.nextIndex !== null) throw new Error('Unexpected probe output');
 const value = JSON.parse(page.value.text);
 backendStatus.textContent = value.state === 'active' ? 'backend:active' : 'backend:missing';
	writeButton.addEventListener('click', async () => {
		writeButton.disabled = true;
		try {
			const current = await nexus.request({ method: 'storage.get', params: { key: 'frontend.demo' } });
			if (current.method !== 'storage.get') throw new Error('Unexpected storage response');
			const oldValue = current.value?.valueJson ? JSON.parse(current.value.valueJson) : null;
			const counter = oldValue === null ? 1 : oldValue.counter + 1;
			if (!Number.isSafeInteger(counter) || counter < 1) throw new Error('Invalid fixture counter');
			const next = await nexus.request({
				method: 'storage.put',
				params: {
					key: 'frontend.demo',
					operationId: crypto.randomUUID(),
					expectedVersion: current.value?.version ?? 0,
					valueJson: JSON.stringify({ source: 'frontend', counter }),
				},
			});
			if (next.method !== 'storage.put') throw new Error('Unexpected storage write response');
			storageResult.textContent = `storage:version:${next.value.version}:counter:${counter}`;
		} catch {
			// A write may have committed: the next explicit click reads its current version.
			storageResult.textContent = 'storage:error:verify stored data before retrying';
		} finally {
			writeButton.disabled = false;
		}
	});
} catch {
	frontendStatus.textContent = 'frontend:error:SDK initialization failed';
}
