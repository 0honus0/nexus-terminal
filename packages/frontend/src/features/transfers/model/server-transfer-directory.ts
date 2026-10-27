import { readRemoteFilePathRequest } from '@nexus-terminal/shared/remote/files/http-codec';
import { readStoredValue, writeStoredValue, jsonStorageCodec } from '@/foundation/browser';

interface RememberedDirectory {
	path: string;
	createdAt: number;
	version: number;
}

interface DirectoryTarget {
	id: number;
	createdAt: number;
	version: number;
}

function definition(userId: number, targetId: number) {
	return {
		namespace: 'server-transfer-directory.' + targetId,
		version: 1,
		scope: { kind: 'user', id: userId } as const,
		codec: jsonStorageCodec<RememberedDirectory>((value) => {
			if (
				typeof value !== 'object' ||
				value === null ||
				Array.isArray(value) ||
				Object.keys(value).some((key) => !['path', 'createdAt', 'version'].includes(key)) ||
				!('path' in value) ||
				!('createdAt' in value) ||
				!('version' in value) ||
				typeof value.createdAt !== 'number' ||
				!Number.isSafeInteger(value.createdAt) ||
				value.createdAt < 0 ||
				typeof value.version !== 'number' ||
				!Number.isSafeInteger(value.version) ||
				value.version < 1
			)
				return undefined;
			try {
				const path = readRemoteFilePathRequest({ path: value.path }).path;
				if (
					path !== '/' &&
					(path.endsWith('/') ||
						path
							.slice(1)
							.split('/')
							.some((part) => !part || part === '.' || part === '..'))
				)
					return undefined;
				return {
					path,
					createdAt: value.createdAt,
					version: value.version,
				};
			} catch {
				return undefined;
			}
		}),
	};
}

export function readServerTransferDirectory(userId: number, target: DirectoryTarget): string {
	const value = readStoredValue(definition(userId, target.id));
	return value?.createdAt === target.createdAt && value.version === target.version ? value.path : '';
}

export function rememberServerTransferDirectory(userId: number, target: DirectoryTarget, path: string): void {
	writeStoredValue(definition(userId, target.id), {
		path: readRemoteFilePathRequest({ path }).path,
		createdAt: target.createdAt,
		version: target.version,
	});
}
