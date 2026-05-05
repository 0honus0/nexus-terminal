import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/backend/vitest.config.ts',
  'packages/frontend/vitest.config.ts',
  'packages/remote-gateway/vitest.config.ts',
]);
