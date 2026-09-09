import { loadRuntimeConfig } from '../config/runtime-config';
import { createBackendApplication } from './application';
import { initializeEnvironment } from './environment';

export const main = async (): Promise<void> => {
  const environment = await initializeEnvironment();
  const config = loadRuntimeConfig(environment.dataDirectory);
  const application = createBackendApplication(config);

  await application.start();
  console.log(`Nexus backend listening on http://${config.host}:${config.port}`);

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (exitCode?: number): Promise<void> => {
    if (!shutdownPromise) {
      shutdownPromise = application.stop().catch((error) => {
        console.error('Backend shutdown failed:', error);
        process.exitCode = 1;
      });
    }
    if (exitCode !== undefined) process.exitCode = exitCode;
    return shutdownPromise;
  };

  const fatal = (label: string, error: unknown): void => {
    console.error(`[Backend] ${label}:`, error);
    void shutdown(1).finally(() => process.exit(1));
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('unhandledRejection', (reason) => fatal('Unhandled promise rejection', reason));
  process.once('uncaughtException', (error) => fatal('Uncaught exception', error));
};
