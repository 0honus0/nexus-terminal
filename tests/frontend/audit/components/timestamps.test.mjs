import { test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Row from '../../../../packages/frontend/src/features/audit/views/AuditLogRow.vue';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';

test('audit row preserves server millisecond timestamps and the actual event identity', async () => {
	await setLocale('en-US');
	const row = mount(Row, {
		props: {
			log: {
				id: 7,
				createdAt: 1700000000123,
				event: 'LOGIN_SUCCESS',
				userId: 1,
				sourceIp: null,
				subjectId: 'current activity',
				route: null,
				statusCode: 200,
			},
		},
		global: { plugins: [i18n] },
	});
	try {
		expect(row.attributes('data-audit-id')).toBe('7');
		expect(row.find('time').attributes('datetime')).toBe('2023-11-14T22:13:20.123Z');
		expect(row.text()).toContain('current activity');
		expect(row.find('time').text()).toContain('2023');
	} finally {
		row.unmount();
	}
});
