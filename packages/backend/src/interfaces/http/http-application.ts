import express, { type Express } from 'express';
import type { SystemHealthService } from '../../modules/system/system-health.service';

export interface HttpApplicationDependencies {
  systemHealthService: SystemHealthService;
}

export const createHttpApplication = (dependencies: HttpApplicationDependencies): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/status', (_request, response) => {
    response.json(dependencies.systemHealthService.get());
  });

  return app;
};
