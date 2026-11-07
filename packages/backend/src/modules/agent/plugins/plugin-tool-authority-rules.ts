import { createHash } from 'node:crypto';

export function pluginToolName(packageId: string, name: string): string {
	return (
		'p_' +
		createHash('sha256')
			.update(packageId + '\0' + name)
			.digest('hex')
			.slice(0, 62)
	);
}
