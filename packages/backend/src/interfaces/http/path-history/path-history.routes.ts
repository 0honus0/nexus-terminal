import { Router } from 'express';
import type {
  PathHistoryAddRequestDto,
  PathHistoryAddResponseDto,
  PathHistoryClearResponseDto,
  PathHistoryEntryDto,
} from '@nexus-terminal/protocol/filesystem-catalog';
import type { PathHistoryService } from '../../../modules/path-history/path-history.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';
export const createPathHistoryRouter = (service: PathHistoryService): Router => {
  const r = Router();
  r.use(requireAuthenticated);
  r.get(
    '/',
    route(async (_q, s) => {
      const payload: PathHistoryEntryDto[] = await service.list();
      s.json(payload);
    }),
  );
  r.post(
    '/',
    route(async (q, s) => {
      const body = (q.body ?? {}) as Partial<PathHistoryAddRequestDto>;
      const path = body.path;
      if (typeof path !== 'string' || !path.trim()) {
        s.status(400).json({ message: '路径不能为空' });
        return;
      }
      const payload: PathHistoryAddResponseDto = { id: await service.add(path), message: '路径已添加到历史记录' };
      s.status(201).json(payload);
    }),
  );
  r.delete(
    '/:id',
    route(async (q, s) => {
      const id = parsePositiveId(String(q.params.id));
      if (!id) {
        s.status(400).json({ message: '无效的 ID' });
        return;
      }
      if (!(await service.delete(id))) {
        s.status(404).json({ message: '未找到要删除的路径历史记录' });
        return;
      }
      s.json({ message: '路径历史记录已删除' });
    }),
  );
  r.delete(
    '/',
    route(async (_q, s) => {
      const count = await service.clear();
      const payload: PathHistoryClearResponseDto = { count, message: `已清空 ${count} 条路径历史记录` };
      s.json(payload);
    }),
  );
  return r;
};
