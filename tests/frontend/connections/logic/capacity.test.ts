import { expect, test } from 'vitest';
import { parseConnectionScript } from '../../../../packages/frontend/src/features/connections/model/connection-script';

test('local connection scripts preserve more than 500 entries and one MiB before protocol batching', () => {
	const source = Array.from(
		{ length: 501 },
		(_, index) => `user@host.example -name "bulk-${index}" -note "${'n'.repeat(2200)}"`,
	).join('\n');
	expect(new TextEncoder().encode(source).byteLength).toBeGreaterThan(1024 * 1024);
	const inputs = parseConnectionScript(source, [], []);
	expect(inputs).toHaveLength(501);
	expect(inputs[500]?.connection.name).toBe('bulk-500');
	expect(inputs[500]?.connection.notes).toBe('n'.repeat(2200));
	expect(() => parseConnectionScript(`${source}\ninvalid-line`, [], [])).toThrow();
});
