import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import {
  SERVER_TRANSFER_METHODS,
  type SendFilesRequestDto,
  type ServerTransferTaskDto,
} from '@nexus-terminal/protocol/transfers';
import { Router } from 'express';
import type { TransfersService } from '../../../modules/transfers/transfers.service';
import type { InitiateTransferPayload, TransferTask } from '../../../modules/transfers/transfers.types';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage, isRecord } from '../shared/http-utils';
import { route } from '../shared/route-handler';

const transferMethods = new Set(SERVER_TRANSFER_METHODS);

const initiateTransferInput = (body: unknown): InitiateTransferPayload => {
  if (!isRecord(body)) throw new Error('请求体必须是对象。');
  const request = body as Partial<SendFilesRequestDto>;
  if (typeof request.sourceConnectionId !== 'number') throw new Error('sourceConnectionId 无效。');
  if (!Array.isArray(request.connectionIds) || !request.connectionIds.every((id) => typeof id === 'number'))
    throw new Error('connectionIds 无效。');
  if (!Array.isArray(request.sourceItems)) throw new Error('sourceItems 无效。');
  const sourceItems = request.sourceItems.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.name !== 'string' ||
      typeof item.path !== 'string' ||
      (item.type !== 'file' && item.type !== 'directory')
    )
      throw new Error('sourceItems 无效。');
    return { name: item.name, path: item.path, type: item.type };
  });
  if (typeof request.remoteTargetPath !== 'string') throw new Error('remoteTargetPath 无效。');
  if (typeof request.transferMethod !== 'string' || !transferMethods.has(request.transferMethod))
    throw new Error('transferMethod 无效。');
  return {
    sourceConnectionId: request.sourceConnectionId,
    connectionIds: [...request.connectionIds],
    sourceItems,
    remoteTargetPath: request.remoteTargetPath,
    transferMethod: request.transferMethod,
  };
};

const transferTaskDto = (task: TransferTask): ServerTransferTaskDto => ({
  taskId: task.taskId,
  status: task.status,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
  subTasks: task.subTasks.map((subTask) => ({
    subTaskId: subTask.subTaskId,
    connectionId: subTask.connectionId,
    sourceItemName: subTask.sourceItemName,
    status: subTask.status,
    ...(subTask.progress === undefined ? {} : { progress: subTask.progress }),
    ...(subTask.message === undefined ? {} : { message: subTask.message }),
    ...(subTask.transferMethodUsed === undefined ? {} : { transferMethodUsed: subTask.transferMethodUsed }),
    ...(subTask.startTime === undefined ? {} : { startTime: subTask.startTime.toISOString() }),
    ...(subTask.endTime === undefined ? {} : { endTime: subTask.endTime.toISOString() }),
  })),
  ...(task.overallProgress === undefined ? {} : { overallProgress: task.overallProgress }),
  payload: {
    sourceConnectionId: task.payload.sourceConnectionId,
    connectionIds: [...task.payload.connectionIds],
    sourceItems: task.payload.sourceItems.map((item) => ({ ...item })),
    remoteTargetPath: task.payload.remoteTargetPath,
    transferMethod: task.payload.transferMethod,
  },
  ...(task.sourceConnectionId === undefined ? {} : { sourceConnectionId: task.sourceConnectionId }),
  ...(task.remoteTargetPath === undefined ? {} : { remoteTargetPath: task.remoteTargetPath }),
});
export const createTransfersRouter = (transfers: TransfersService): Router => {
  const r = Router();
  r.use(requireAuthenticated);
  r.post(
    '/send',
    route(async (q, s) => {
      try {
        s.status(202).json(transferTaskDto(await transfers.initiate(initiateTransferInput(q.body), q.session.userId!)));
      } catch (error) {
        s.status(400).json({ message: errorMessage(error) });
      }
    }),
  );
  r.get(
    '/status',
    route(async (q, s) => {
      s.json(transfers.list(q.session.userId!).map(transferTaskDto));
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
      s.json(transferTaskDto(task));
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
      const payload: MessageResponseDto = { message: `Transfer task ${id} cancellation initiated.` };
      s.json(payload);
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
