import { Router } from 'express';
import type {
  QuickCommandBulkAssignTagRequestDto,
  QuickCommandBulkAssignTagResponseDto,
  QuickCommandDto,
  QuickCommandIncrementResponseDto,
  QuickCommandListQueryDto,
  QuickCommandMutationRequestDto,
  QuickCommandMutationResponseDto,
} from '@nexus-terminal/protocol/quick-commands';
import type { QuickCommandService } from '../../../modules/quick-commands/quick-command.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage, isRecord, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

interface ParsedQuickCommandBody {
  name: string | null;
  command: string;
  tagIds: number[];
  variables?: Record<string, string>;
  validName: boolean;
  validTagIds: boolean;
  validVariables: boolean;
}

const decodeVariables = (value: unknown): Record<string, string> | null => {
  if (!isRecord(value)) return null;
  const variables: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return null;
    variables[key] = entry;
  }
  return variables;
};

const parseBody = (body: unknown): ParsedQuickCommandBody => {
  if (!isRecord(body)) {
    return {
      name: null,
      command: '',
      tagIds: [],
      validName: true,
      validTagIds: true,
      validVariables: true,
    };
  }

  const request = body as Partial<QuickCommandMutationRequestDto>;
  const validName = request.name === undefined || request.name === null || typeof request.name === 'string';
  const validTagIds =
    request.tagIds === undefined ||
    (Array.isArray(request.tagIds) &&
      request.tagIds.every((value): value is number => typeof value === 'number' && Number.isInteger(value)));
  const decodedVariables = request.variables === undefined ? undefined : decodeVariables(request.variables);
  const validVariables = request.variables === undefined || decodedVariables !== null;

  return {
    name: request.name === null ? null : typeof request.name === 'string' ? request.name : null,
    command: typeof request.command === 'string' ? request.command : '',
    tagIds:
      Array.isArray(request.tagIds) &&
      request.tagIds.every((value): value is number => typeof value === 'number' && Number.isInteger(value))
        ? request.tagIds
        : [],
    ...(decodedVariables ? { variables: decodedVariables } : {}),
    validName,
    validTagIds,
    validVariables,
  };
};

const validateBody = (input: ParsedQuickCommandBody): string | null => {
  if (!input.validName) return '名称必须是字符串或 null';
  if (!input.validTagIds) return 'tagIds 必须是一个数字数组';
  if (!input.validVariables) return 'variables 必须是字符串映射';
  return null;
};

export const createQuickCommandsRouter = (commands: QuickCommandService): Router => {
  const router = Router();
  router.use(requireAuthenticated);
  router.get(
    '/',
    route(async (request, response) => {
      const query: QuickCommandListQueryDto = {
        sortBy: request.query.sortBy === 'usageCount' ? 'usageCount' : 'name',
      };
      const payload: QuickCommandDto[] = await commands.list(query.sortBy ?? 'name');
      response.json(payload);
    }),
  );
  router.post(
    '/bulk-assign-tag',
    route(async (request, response) => {
      const body = (request.body ?? {}) as Partial<QuickCommandBulkAssignTagRequestDto>;
      const ids = body.commandIds;
      const tagId = body.tagId;
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        !ids.every(Number.isInteger) ||
        typeof tagId !== 'number' ||
        !Number.isInteger(tagId)
      ) {
        response
          .status(400)
          .json({ success: false, message: '请求体必须包含 commandIds (非空数字数组) 和 tagId (数字)。' });
        return;
      }
      await commands.assignTag(ids, tagId);
      const payload: QuickCommandBulkAssignTagResponseDto = {
        success: true,
        message: `标签 ${tagId} 已成功尝试关联到 ${ids.length} 个指令。`,
      };
      response.json(payload);
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
      const validationError = validateBody(input);
      if (validationError) {
        response.status(400).json({ message: validationError });
        return;
      }
      try {
        const id = await commands.add(input.name, input.command, input.tagIds, input.variables);
        const command = await commands.get(id);
        const payload: QuickCommandMutationResponseDto = command
          ? { message: '快捷指令已添加', command }
          : { message: '快捷指令已添加，但无法检索新记录', command: null, id };
        response.status(201).json(payload);
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
      const validationError = validateBody(input);
      if (validationError) {
        response.status(400).json({ message: validationError });
        return;
      }
      if (!(await commands.update(id, input.name, input.command, input.tagIds, input.variables))) {
        response.status(404).json({ message: '未找到要更新的快捷指令' });
        return;
      }
      const command = await commands.get(id);
      const payload: QuickCommandMutationResponseDto = { message: '快捷指令已更新', command };
      response.json(payload);
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
      if (!(await commands.incrementUsage(id))) {
        response.status(404).json({ message: '未找到快捷指令' });
        return;
      }
      const command = await commands.get(id);
      const payload: QuickCommandIncrementResponseDto = { message: '使用次数已记录', command };
      response.json(payload);
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
