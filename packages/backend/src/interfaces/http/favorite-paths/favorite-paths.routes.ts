import { Router } from 'express';
import type { FavoritePathService } from '../../../modules/favorite-paths/favorite-path.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

export const createFavoritePathsRouter = (service: FavoritePathService): Router => {
  const r = Router();
  r.use(requireAuthenticated);
  r.get(
    '/',
    route(async (q, s) => {
      s.json(await service.list(q.query.sortBy === 'lastUsedAt' ? 'lastUsedAt' : 'name'));
    }),
  );
  r.post(
    '/',
    route(async (q, s) => {
      const { name = null, path } = q.body ?? {};
      if (typeof path !== 'string' || !path.trim()) {
        s.status(400).json({ message: '路径内容不能为空' });
        return;
      }
      if (name !== null && typeof name !== 'string') {
        s.status(400).json({ message: '名称必须是字符串或 null' });
        return;
      }
      const id = await service.add(name, path);
      const favorite = await service.get(id);
      s.status(201).json({ message: '收藏路径已添加', favoritePath: favorite });
    }),
  );
  r.get(
    '/:id',
    route(async (q, s) => {
      const id = parsePositiveId(String(q.params.id));
      if (!id) {
        s.status(400).json({ message: '无效的 ID' });
        return;
      }
      const item = await service.get(id);
      if (!item) {
        s.status(404).json({ message: '未找到指定的收藏路径' });
        return;
      }
      s.json(item);
    }),
  );
  r.put(
    '/:id/update-last-used',
    route(async (q, s) => {
      const id = parsePositiveId(String(q.params.id));
      if (!id) {
        s.status(400).json({ message: '无效的 ID' });
        return;
      }
      if (!(await service.touch(id))) {
        s.status(404).json({ message: '未找到要更新上次使用时间戳的收藏路径' });
        return;
      }
      const favorite = await service.get(id);
      s.json({ message: '上次使用时间戳已更新', favoritePath: favorite });
    }),
  );
  r.put(
    '/:id',
    route(async (q, s) => {
      const id = parsePositiveId(String(q.params.id));
      const { name = null, path } = q.body ?? {};
      if (!id) {
        s.status(400).json({ message: '无效的 ID' });
        return;
      }
      if (typeof path !== 'string' || !path.trim()) {
        s.status(400).json({ message: '路径内容不能为空' });
        return;
      }
      if (name !== null && typeof name !== 'string') {
        s.status(400).json({ message: '名称必须是字符串或 null' });
        return;
      }
      if (!(await service.update(id, name, path))) {
        s.status(404).json({ message: '未找到要更新的收藏路径' });
        return;
      }
      const favorite = await service.get(id);
      s.json({ message: '收藏路径已更新', favoritePath: favorite });
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
        s.status(404).json({ message: '未找到要删除的收藏路径' });
        return;
      }
      s.json({ message: '收藏路径已删除' });
    }),
  );
  return r;
};
