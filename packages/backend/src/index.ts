import { main } from './bootstrap/main';

void main().catch((error) => {
  console.error('Backend startup failed:', error);
  process.exitCode = 1;
});
