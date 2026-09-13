import { connectNexusPlugin } from '/sdk/frontend-v1.mjs';

const frontendStatus = document.querySelector('[data-testid="fullstack-frontend-status"]');
const backendStatus = document.querySelector('[data-testid="fullstack-backend-status"]');
const writeButton = document.querySelector('[data-testid="fullstack-write-storage"]');
const storageResult = document.querySelector('[data-testid="fullstack-storage-result"]');

try {
  const nexus = await connectNexusPlugin();
  const app = await nexus.host.appInfo();
  frontendStatus.textContent = `frontend:ready:${app.appId}@${app.version}`;

  const backend = await nexus.storage.get('backend.status');
  backendStatus.textContent = backend?.value?.state === 'active' ? 'backend:active' : 'backend:missing';

  writeButton.addEventListener('click', async () => {
    writeButton.disabled = true;
    try {
      const current = await nexus.storage.get('frontend.demo');
      const next = await nexus.storage.put(
        'frontend.demo',
        { source: 'frontend', counter: Number(current?.value?.counter ?? 0) + 1 },
        current?.version ?? null,
      );
      storageResult.textContent = `storage:version:${next.version}:counter:${next.value.counter}`;
    } catch (error) {
      storageResult.textContent = `storage:error:${error instanceof Error ? error.message : String(error)}`;
    } finally {
      writeButton.disabled = false;
    }
  });
} catch (error) {
  frontendStatus.textContent = `frontend:error:${error instanceof Error ? error.message : String(error)}`;
}
