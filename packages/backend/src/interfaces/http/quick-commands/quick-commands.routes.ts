import { Router } from 'express';
import type { QuickCommandService } from '../../../modules/quick-commands/quick-command.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

const parseBody = (body: any) => ({
  name: body?.name === null ? null : typeof body?.name === 'string' ? body.name : null,
  command: typeof body?.command === 'string' ? body.command : '',
  tagIds: Array.isArray(body?.tagIds) ? body.tagIds : [],
  variables:
    body?.variables && typeof body.variables === 'object' && !Array.isArray(body.variables)
      ? body.variables
      : undefined,
});

export const createQuickCommandsRouter = (commands: QuickCommandService): Router => {
  const router = Router();
  router.use(requireAuthenticated);
  router.get(
    '/',
    route(async (request, response) => {
      response.json(await commands.list(request.query.sortBy === 'usage_count' ? 'usage_count' : 'name'));
    }),
  );
  router.post(
    '/bulk-assign-tag',
    route(async (request, response) => {
      const ids = request.body?.commandIds;
      const tagId = request.body?.tagId;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every(Number.isInteger) || !Number.isInteger(tagId)) {
        response
          .status(400)
          .json({ success: false, message: '请求体必须包含 commandIds (非空数字数组) 和 tagId (数字)。' });
        return;
      }
      await commands.assignTag(ids, tagId);
      response.json({ success: true, message: `标签 ${tagId} 已成功尝试关联到 ${ids.length} 个指令。` });
    }),
  );
  router.post(
    '/',
    route(async (request, response) => {
      const input = parseBody(request.body);
      if (!input.command.trim()) {
        response.status(400).json({ message: '指令内容不能为空' });
        return;
      }
      if (request.body?.name !== null && request.body?.name !== undefined && typeof request.body.name !== 'string') {
        response.status(400).json({ message: '名称必须是字符串或 null' });
        return;
      }
      if (
        request.body?.tagIds !== undefined &&
        (!Array.isArray(request.body.tagIds) || !request.body.tagIds.every(Number.isInteger))
      ) {
        response.status(400).json({ message: 'tagIds 必须是一个数字数组' });
        return;
      }
      try {
        const id = await commands.add(input.name, input.command, input.tagIds, input.variables);
        const command = await commands.get(id);
        response
          .status(201)
          .json(command ? { message: '快捷指令已添加', command } : { message: '快捷指令已添加，但无法检索新记录', id });
      } catch (error) {
        response.status(500).json({ message: errorMessage(error) });
      }
    }),
  );
  router.put(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的 ID' });
        return;
      }
      const input = parseBody(request.body);
      if (!input.command.trim()) {
        response.status(400).json({ message: '指令内容不能为空' });
        return;
      }
      if (!(await commands.update(id, input.name, input.command, input.tagIds, input.variables))) {
        response.status(404).json({ message: '未找到要更新的快捷指令' });
        return;
      }
      response.json({ message: '快捷指令已更新', command: await commands.get(id) });
    }),
  );
  router.post(
    '/:id/increment-usage',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的 ID' });
        return;
      }
      await commands.incrementUsage(id);
      response.json({ message: '使用次数已记录 (或指令不存在)' });
    }),
  );
  router.delete(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的 ID' });
        return;
      }
      if (!(await commands.delete(id))) {
        response.status(404).json({ message: '未找到要删除的快捷指令' });
        return;
      }
      response.json({ message: '快捷指令已删除' });
    }),
  );
  return router;
};
