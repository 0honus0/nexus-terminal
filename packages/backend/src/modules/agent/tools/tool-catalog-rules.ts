import Fuse from 'fuse.js';
import type { ToolCatalogState } from '../governance/model/governance-types.js';
import type { PluginAgentCatalog } from '../plugins/model/plugin-contribution-types.js';
import type { ToolDefinition } from './model/tool-types.js';

const coreNames = new Set([
	'tool_search',
	'machine_connection_list',
	'shell_execute',
	'shell_job_control',
	'tool_result_read',
	'context_checkpoint',
	'file_read',
	'file_list',
	'file_search',
	'skill_search',
	'skill_read',
]);

/** Discovery and model exposure share the same live permission and target projection. */
export function authorizedToolDefinitions(
	definitions: ToolDefinition[],
	catalog: ToolCatalogState,
	plugin: PluginAgentCatalog,
): ToolDefinition[] {
	const contribution = plugin.contribution;
	return definitions.filter(
		(tool) =>
			catalog.capabilities.includes(tool.capability) &&
			(tool.name !== 'file_deliver' || catalog.capabilities.includes('artifacts.write')) &&
			(contribution?.toolNames == null || contribution.toolNames.includes(tool.name)) &&
			(tool.name !== 'plugin_tool_call' || (contribution !== null && contribution.tools.length > 0)) &&
			(!tool.input.fields.some((field) => field.name === 'connectionId') || catalog.connectionIds.length > 0) &&
			(!['acp_integration_list', 'acp_integration_execute'].includes(tool.name) ||
				catalog.connectionIds.length > 0),
	);
}

export function exposedToolDefinitions(available: ToolDefinition[], loaded: ReadonlySet<string>): ToolDefinition[] {
	if (!available.some((tool) => tool.name === 'tool_search')) {
		return available;
	}
	// Keep the core prefix and previous activation order stable across model turns.
	const core = available.filter((tool) => coreNames.has(tool.name));
	const byName = new Map(available.map((tool) => [tool.name, tool]));
	for (const name of loaded) {
		const tool = byName.get(name);
		if (tool && !coreNames.has(name)) {
			core.push(tool);
		}
	}
	return core;
}

const categories: [string, string][] = [
	['browser_', 'browser web 浏览器 网页 页面'],
	['mcp_', 'MCP 集成 外部工具 资源 提示词'],
	['acp_', 'ACP 集成 代理 编程'],
	['machine_docker_', 'Docker 容器 镜像'],
	['machine_connection_', 'SSH 服务器 连接 目标'],
	['machine_diagnostics_', '服务器 诊断'],
	['host_diagnostics_', '宿主 诊断'],
	['shell_', 'shell exec SSH 命令 执行 进程 后台 任务'],
	['file_', 'file 文件 目录'],
	['file_deliver', 'deliver 交付 下载 展示'],
	['image_', 'image 图片 图像 绘图'],
	['artifact_', 'artifact 产物 文件 交付 展示 下载'],
	['memory_', 'memory 记忆'],
	['project_', 'project 项目 工作目录 指引'],
	['collaboration_', 'collaboration 协作 委派 子任务 消息'],
	['skill_', 'skill 技能 指引'],
	['plugin_', 'plugin 插件 应用 自定义工具'],
	['context_', 'context 上下文 检查点 压缩'],
	['tool_result_', 'result 结果 输出'],
];

const actions: [string, string][] = [
	['_screenshot', '截图'],
	['_snapshot', '快照 摘要'],
	['_console', '控制台 日志'],
	['_navigate', '导航 跳转'],
	['_click', '点击'],
	['_type', '输入'],
	['_open', '打开'],
	['_close', '关闭'],
	['_read', '读取'],
	['_list', '列出 列表'],
	['_search', '搜索 查找'],
	['_inspect', '检查'],
	['_generate', '生成 生成图片'],
	['_write', '写入'],
	['_patch', '修改 补丁'],
	['_move', '移动'],
	['_delete', '删除'],
	['_upload', '上传'],
	['_download', '下载'],
];

/** No schema duplication or arbitrary top-K: the original result/context budgets still apply. */
export function searchToolDefinitions(available: ToolDefinition[], query: string): ToolDefinition[] {
	const normalized = query.trim();
	if (normalized === '*') {
		return available.filter((tool) => tool.name !== 'tool_search');
	}
	const names = normalized.split(/[\s,，]+/u).filter(Boolean);
	if (!names.length) {
		return [];
	}
	const candidates = available.filter((tool) => tool.name !== 'tool_search');
	if (names.every((word) => /^[a-z][a-z0-9]*_[a-z0-9_]+$/iu.test(word))) {
		const requested = new Set(names.map((word) => word.toLowerCase()));
		return candidates.filter((tool) => requested.has(tool.name));
	}
	const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
	const words = [
		...new Set([...segmenter.segment(normalized)].filter((word) => word.isWordLike).map((word) => word.segment)),
	];
	if (!words.length) {
		return [];
	}
	const index = candidates.map((tool) => ({
		tool,
		name: tool.name.replaceAll('_', ' '),
		description: tool.description,
		parameters: tool.input.fields.map((field) => field.name).join(' '),
		aliases: [
			...categories.filter(([prefix]) => tool.name.startsWith(prefix)),
			...actions.filter(([suffix]) => tool.name.endsWith(suffix)),
		]
			.map(([, aliases]) => aliases)
			.join(' '),
	}));
	const keys = ['name', 'description', 'parameters', 'aliases'];
	// Fuse's include-match syntax accepts task keywords anywhere without fuzzy false positives
	// such as MCP matching ACP or Docker loading almost the whole catalog.
	const search = new Fuse(index, { keys, useExtendedSearch: true });
	return search
		.search({ $and: words.map((word) => ({ $or: keys.map((key) => ({ [key]: "'" + word })) })) })
		.map((match) => match.item.tool);
}
