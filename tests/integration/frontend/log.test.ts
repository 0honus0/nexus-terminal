import { describe, expect, it, vi } from 'vitest';
import { LogApi } from '../../../src/log/browser/log-api.js';
import { PluginScope } from '../../../src/plugin/plugin-api.js';

describe('浏览器日志', () => {
	it('保留当前实例最近 500 条记录，输出异常时仍可查询，清空不影响通知', () => {
		const writer = {
			write: vi.fn(() => {
				throw new Error('output unavailable');
			}),
		};
		const log = new LogApi(writer);
		log.report({ source: 'fixture', level: 'warn', code: 'VISIBLE', userVisible: true });
		for (let index = 0; index < 501; index++) {
			log.report({ source: 'fixture', level: 'info', code: 'RETAINED', params: { index } });
		}
		expect(log.history.entries.value).toHaveLength(500);
		expect(log.history.entries.value.at(0)?.params?.index).toBe(1);
		expect(log.history.entries.value.at(-1)?.params?.index).toBe(500);
		expect(new LogApi(writer).history.entries.value).toEqual([]);

		log.history.clear();
		expect(log.history.entries.value).toEqual([]);
		expect(log.notices.value.map(({ code }) => code)).toEqual(['VISIBLE']);
		expect(writer.write).toHaveBeenCalledTimes(502);
		log.dismissNotice(log.notices.value[0]!.id);
		expect(log.notices.value).toEqual([]);
	});

	it('绑定插件来源，脱敏并保存快照，拒绝伪造和已卸载输入', async () => {
		const log = new LogApi({ write: vi.fn() });
		const scope = new PluginScope(() => {});
		const plugin = log.bind('@test/log', scope);
		const params = { password: 'secret', rows: 3 };
		plugin.report({ level: 'info', code: 'VALID', params });
		params.rows = 4;
		const invalid = { level: 'info', code: 'FORGED', source: 'app', userVisible: true } as const;
		plugin.report(invalid);

		const getter = vi.fn(() => 'IGNORED');
		await scope.close();
		plugin.report({
			level: 'info',

			get code() {
				return getter();
			},
		});
		expect(getter).not.toHaveBeenCalled();
		expect(log.history.entries.value).toHaveLength(1);
		expect(log.history.entries.value[0]).toMatchObject({
			code: 'VALID',
			source: '@test/log',
			pluginId: '@test/log',
			params: { password: '[Redacted]', rows: 3 },
		});
		expect(log.notices.value).toEqual([]);
	});
});
