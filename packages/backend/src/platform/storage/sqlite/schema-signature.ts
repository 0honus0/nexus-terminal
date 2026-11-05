import { createHash } from 'node:crypto';

/** Snapshot identity covers the complete ordered migration chain, including data-only migrations. */
export function sqliteSchemaSignature(versions: readonly { version: number; signature: string }[]): string {
	return createHash('sha256')
		.update(JSON.stringify(versions.map((item) => ({ version: item.version, signature: item.signature }))))
		.digest('hex');
}
