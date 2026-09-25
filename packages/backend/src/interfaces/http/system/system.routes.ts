import type { RemoteResourceStatusDto, ResourceStatusDto, SshResourceStatusDto } from '@nexus-terminal/protocol/system';
import { Router } from 'express';
import type { ServerStatus } from '../../../platform/system/server-status.port';
import type { SshResourceStatusService } from '../../../modules/system/ssh-resource-status.service';
import type { SystemStatusService } from '../../../modules/system/system-status.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage } from '../shared/http-utils';
import { route } from '../shared/route-handler';

const remoteResourceStatusDto = (status: ServerStatus): RemoteResourceStatusDto => ({ ...status });

const sshResourceStatusDto = (
  resource: Awaited<ReturnType<SshResourceStatusService['getSshResourceStatuses']>>[number],
): SshResourceStatusDto => ({
  key: resource.key,
  connectionId: resource.connectionId,
  name: resource.name,
  username: resource.username,
  host: resource.host,
  port: resource.port,
  ...(resource.status ? { status: remoteResourceStatusDto(resource.status) } : {}),
  ...(resource.error === undefined ? {} : { error: resource.error }),
  checkedAt: resource.checkedAt,
});

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
        const payload: ResourceStatusDto = await dependencies.systemStatus.getLocalSystemStatus();
        s.json(payload);
      } catch (error) {
        s.status(500).json({ message: errorMessage(error) });
      }
    }),
  );
  r.get(
    '/ssh-resources',
    route(async (_q, s) => {
      try {
        const payload: SshResourceStatusDto[] = (await dependencies.sshResourceStatus.getSshResourceStatuses()).map(
          sshResourceStatusDto,
        );
        s.json(payload);
      } catch (error) {
        s.status(500).json({ message: errorMessage(error) });
      }
    }),
  );
  return r;
};
