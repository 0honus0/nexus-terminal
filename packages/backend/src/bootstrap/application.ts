import http, { type Server } from 'node:http';
import type { RuntimeConfig } from '../config/runtime-config';
import { createHttpApplication } from '../interfaces/http/http-application';
import { createCompositionRoot, type CompositionRoot } from './composition-root';

export interface BackendApplication {
  readonly server: Server;
  readonly services: CompositionRoot;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const createBackendApplication = (config: RuntimeConfig): BackendApplication => {
  const services = createCompositionRoot(config);
  const httpApplication = createHttpApplication({
    systemHealthService: services.modules.systemHealth,
  });
  const server = http.createServer(httpApplication);

  return {
    server,
    services,
    start: async () => {
      await services.initialize();
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => reject(error);
          server.once('error', onError);
          server.listen(config.port, config.host, () => {
            server.off('error', onError);
            resolve();
          });
        });
      } catch (error) {
        await services.dispose();
        throw error;
      }
    },
    stop: async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close((error) => error ? reject(error) : resolve());
        });
      } finally {
        await services.dispose();
      }
    },
  };
};
