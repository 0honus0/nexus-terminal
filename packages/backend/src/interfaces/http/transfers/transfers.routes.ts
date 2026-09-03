import { Router } from 'express';
import type { TransfersService } from '../../../modules/transfers/transfers.service';
import type { InitiateTransferPayload } from '../../../modules/transfers/transfers.types';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage } from '../shared/http-utils';
import { route } from '../shared/route-handler';
export const createTransfersRouter = (transfers: TransfersService): Router => {
  const r = Router();
  r.use(requireAuthenticated);
  r.post(
    '/send',
    route(async (q, s) => {
      try {
        s.status(202).json(await transfers.initiate(q.body as InitiateTransferPayload, q.session.userId!));
      } catch (error) {
        s.status(400).json({ message: errorMessage(error) });
      }
    }),
  );
  r.get(
    '/status',
    route(async (q, s) => {
      s.json(transfers.list(q.session.userId!));
    }),
  );
  r.get(
    '/status/:taskId',
    route(async (q, s) => {
      const task = transfers.details(String(q.params.taskId), q.session.userId!);
      if (!task) {
        s.status(404).json({
          message: `Transfer task with ID ${String(q.params.taskId)} not found or not accessible by this user.`,
        });
        return;
      }
      s.json(task);
    }),
  );
  r.post(
    '/cancel/:taskId',
    route(async (q, s) => {
      const id = String(q.params.taskId);
      if (!transfers.cancel(id, q.session.userId!)) {
        s.status(404).json({
          message: `Failed to initiate cancellation for task ${id}. It may not exist, not be accessible, or already be in a final state.`,
        });
        return;
      }
      s.json({ message: `Transfer task ${id} cancellation initiated.` });
    }),
  );
  r.delete(
    '/:taskId',
    route(async (q, s) => {
      const result = transfers.remove(String(q.params.taskId), q.session.userId!);
      if (result === 'removed') {
        s.status(204).end();
        return;
      }
      if (result === 'active') {
        s.status(409).json({ message: 'Active transfer tasks must be cancelled before removal.' });
        return;
      }
      s.status(404).json({ message: 'Transfer task not found or not accessible.' });
    }),
  );
  return r;
};
