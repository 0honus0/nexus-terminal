import { Router } from 'express';
import type { QuickCommandTagService } from '../../../modules/quick-command-tags/quick-command-tag.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

export const createQuickCommandTagsRouter = (tags: QuickCommandTagService): Router => {
  const router = Router();
  router.use(requireAuthenticated);
  router.get(
    '/',
    route(async (_request, response) => {
      response.json(await tags.list());
    }),
  );
  router.post(
    '/',
    route(async (request, response) => {
      const name = request.body?.name;
      if (typeof name !== 'string' || !name.trim()) {
        response.status(400).json({ message: '标签名称不能为空且必须是字符串' });
        return;
      }
      try {
        const id = await tags.create(name);
        const tag = await tags.get(id);
        response.status(201).json({ message: '快捷指令标签已添加', tag });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('UNIQUE') || message.includes('已存在') ? 409 : 500).json({ message });
      }
    }),
  );
  router.put(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id)),
        name = request.body?.name;
      if (!id) {
        response.status(400).json({ message: '无效的标签 ID' });
        return;
      }
      if (typeof name !== 'string' || !name.trim()) {
        response.status(400).json({ message: '标签名称不能为空且必须是字符串' });
        return;
      }
      try {
        if (!(await tags.update(id, name))) {
          response.status(404).json({ message: '未找到要更新的快捷指令标签' });
          return;
        }
        const tag = await tags.get(id);
        response.json({ message: '快捷指令标签已更新', tag });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('UNIQUE') || message.includes('已存在') ? 409 : 500).json({ message });
      }
    }),
  );
  router.delete(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的标签 ID' });
        return;
      }
      if (!(await tags.delete(id))) {
        response.status(404).json({ message: '未找到要删除的快捷指令标签' });
        return;
      }
      response.json({ message: '快捷指令标签已删除' });
    }),
  );
  return router;
};
