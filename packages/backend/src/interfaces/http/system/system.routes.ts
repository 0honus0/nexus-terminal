import { Router } from 'express';
import type { SshResourceStatusService } from '../../../modules/system/ssh-resource-status.service';
import type { SystemStatusService } from '../../../modules/system/system-status.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage } from '../shared/http-utils';
import { route } from '../shared/route-handler';
export const createSystemRouter = (dependencies: {
  systemStatus: SystemStatusService;
  sshResourceStatus: SshResourceStatusService;
}): Router => {
  const r = Router();
  r.use(requireAuthenticated);
  r.get(
    '/status',
    route(async (_q, s) => {
      try {
        s.json(await dependencies.systemStatus.getLocalSystemStatus());
      } catch (error) {
        s.status(500).json({ message: errorMessage(error) });
      }
    }),
  );
  r.get(
    '/ssh-resources',
    route(async (_q, s) => {
      try {
        s.json(await dependencies.sshResourceStatus.getSshResourceStatuses());
      } catch (error) {
        s.status(500).json({ message: errorMessage(error) });
      }
    }),
  );
  return r;
};
