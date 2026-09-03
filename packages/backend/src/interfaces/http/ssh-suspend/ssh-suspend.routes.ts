import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import type { SshSuspendService } from '../../../modules/ssh-suspend/ssh-suspend.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage } from '../shared/http-utils';
import { route } from '../shared/route-handler';
export const createSshSuspendRouter = (service: SshSuspendService): Router => {
  const r = Router();
  r.use(requireAuthenticated);
  r.get(
    '/suspended-sessions',
    route(async (q, s) => {
      s.json(service.list(q.session.userId!));
    }),
  );
  r.delete(
    '/terminate/:suspendSessionId',
    route(async (q, s) => {
      const id = String(q.params.suspendSessionId);
      if (!(await service.terminate(q.session.userId!, id))) {
        s.status(404).json({ message: `Failed to terminate and remove session ${id}.` });
        return;
      }
      s.json({ message: `Suspended session ${id} terminated and removed successfully.` });
    }),
  );
  r.delete(
    '/entry/:suspendSessionId',
    route(async (q, s) => {
      const id = String(q.params.suspendSessionId);
      if (!(await service.removeDisconnected(q.session.userId!, id))) {
        s.status(404).json({ message: `Failed to remove session entry ${id}.` });
        return;
      }
      s.json({ message: `Suspended session entry ${id} removed successfully.` });
    }),
  );
  r.put(
    '/name/:suspendSessionId',
    route(async (q, s) => {
      const id = String(q.params.suspendSessionId),
        name = q.body?.customName;
      if (typeof name !== 'string') {
        s.status(400).json({ message: 'Bad Request. customName must be a string and is missing or invalid.' });
        return;
      }
      try {
        if (!service.rename(q.session.userId!, id, name)) {
          s.status(404).json({ message: `Failed to update name for session ${id}.` });
          return;
        }
        s.json({ message: `Suspended session ${id} name updated to "${name}".`, customName: name });
      } catch (error) {
        s.status(400).json({ message: errorMessage(error) });
      }
    }),
  );
  r.get(
    '/log/:suspendSessionId',
    route(async (q, s) => {
      const data = await service.getSessionLogStream(q.session.userId!, String(q.params.suspendSessionId));
      if (!data) {
        s.status(404).json({ message: 'Failed to export suspended session log.' });
        return;
      }
      s.setHeader('Content-Disposition', `attachment; filename="${data.filename}"`);
      s.type('text/plain; charset=utf-8');
      try {
        await pipeline(data.stream, s);
      } catch (error) {
        if (s.headersSent) s.destroy(error instanceof Error ? error : new Error(String(error)));
        else s.status(500).json({ message: errorMessage(error) });
      }
    }),
  );
  return r;
};
