import { Router } from 'express';
import type { AuditLogService } from '../../../modules/audit/audit.service';
import type { TagService } from '../../../modules/tags/tag.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

export const createTagsRouter = (dependencies: { tags: TagService; audit: AuditLogService }): Router => {
  const router = Router();
  router.use(requireAuthenticated);
  router.get(
    '/',
    route(async (_request, response) => {
      response.json(await dependencies.tags.list());
    }),
  );
  router.post(
    '/',
    route(async (request, response) => {
      const name = request.body?.name;
      if (typeof name !== 'string' || !name.trim()) {
        response.status(400).json({ message: '标签名称不能为空。' });
        return;
      }
      try {
        const tag = await dependencies.tags.create(name);
        await dependencies.audit.logAction('TAG_CREATED', { tagId: tag.id, name: tag.name });
        response.status(201).json({ message: '标签创建成功。', tag });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('已存在') || message.includes('UNIQUE') ? 409 : 500).json({ message });
      }
    }),
  );
  router.get(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的标签 ID。' });
        return;
      }
      const tag = await dependencies.tags.get(id);
      if (!tag) {
        response.status(404).json({ message: '标签未找到。' });
        return;
      }
      response.json(tag);
    }),
  );
  router.put(
    '/:id/connections',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      const ids = request.body?.connection_ids;
      if (!id) {
        response.status(400).json({ message: '无效的标签 ID。' });
        return;
      }
      if (!Array.isArray(ids) || !ids.every(Number.isInteger)) {
        response.status(400).json({ message: 'connection_ids 必须是一个数字数组。' });
        return;
      }
      try {
        await dependencies.tags.setConnections(id, ids);
        response.json({ message: '标签的连接关联更新成功。' });
      } catch (error) {
        response.status(500).json({ message: errorMessage(error) });
      }
    }),
  );
  router.put(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      const name = request.body?.name;
      if (!id) {
        response.status(400).json({ message: '无效的标签 ID。' });
        return;
      }
      if (typeof name !== 'string' || !name.trim()) {
        response.status(400).json({ message: '标签名称不能为空。' });
        return;
      }
      try {
        const tag = await dependencies.tags.update(id, name);
        if (!tag) {
          response.status(404).json({ message: '标签未找到。' });
          return;
        }
        await dependencies.audit.logAction('TAG_UPDATED', { tagId: id, newName: tag.name });
        response.json({ message: '标签更新成功。', tag });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('已存在') || message.includes('UNIQUE') ? 409 : 500).json({ message });
      }
    }),
  );
  router.delete(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的标签 ID。' });
        return;
      }
      if (!(await dependencies.tags.delete(id))) {
        response.status(404).json({ message: '标签未找到。' });
        return;
      }
      await dependencies.audit.logAction('TAG_DELETED', { tagId: id });
      response.json({ message: '标签删除成功。' });
    }),
  );
  return router;
};
