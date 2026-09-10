import { main, reportBackendStartupFailure } from './bootstrap/main';

void main().catch((error) => {
  reportBackendStartupFailure(error);
  process.exitCode = 1;
});
