import { loadRuntimeConfig } from '../config/runtime-config';
import { createBackendApplication } from './application';
import { initializeEnvironment } from './environment';
import { logger } from '../shared/logging/logger';

export const main = async (): Promise<void> => {
  const environment = await initializeEnvironment();
  const config = loadRuntimeConfig(environment.dataDirectory);
  const application = createBackendApplication(config);

  await application.start();
  logger.info({ host: config.host, port: config.port }, 'Nexus backend listening');

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (exitCode?: number): Promise<void> => {
    if (!shutdownPromise) {
      shutdownPromise = application.stop().catch((error) => {
        logger.error({ err: error }, 'Backend shutdown failed');
        process.exitCode = 1;
      });
    }
    if (exitCode !== undefined) process.exitCode = exitCode;
    return shutdownPromise;
  };

  const fatal = (label: string, error: unknown): void => {
    logger.fatal({ err: error, label }, 'Backend fatal error');
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

export const reportBackendStartupFailure = (error: unknown): void => {
  logger.fatal({ err: error }, 'Backend startup failed');
};
