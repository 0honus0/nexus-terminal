import { loadRuntimeConfig } from '../config/runtime-config';
import { createBackendApplication } from './application';

export const main = async (): Promise<void> => {
  const config = loadRuntimeConfig();
  const application = createBackendApplication(config);

  const shutdown = async (): Promise<void> => {
    try {
      await application.stop();
    } catch (error) {
      console.error('Backend shutdown failed:', error);
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });

  await application.start();
  console.log(`Nexus backend listening on http://${config.host}:${config.port}`);
};
