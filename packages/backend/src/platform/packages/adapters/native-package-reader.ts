import { createHash } from 'node:crypto';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Parser } from 'tar';
import { PackageFailure } from '../package-reader.js';
import type { PackageReader, ArchiveFile } from '../package-reader.js';

const inflate = promisify(gunzip);

function safePath(raw: string, directory: boolean): string {
	const path = raw.startsWith('./') ? raw.slice(2) : raw;
	const canonical = directory && path.endsWith('/') ? path.slice(0, -1) : path;
	if (directory && (canonical === '' || canonical === '.')) {
		return '';
	}
	if (
		!canonical ||
		canonical.startsWith('/') ||
		canonical.includes('\\') ||
		/[\u0000-\u001f\u007f]/u.test(canonical) ||
		canonical.length > 4096 ||
		/^[A-Za-z]:/u.test(canonical)
	) {
		throw new PackageFailure('invalid_archive');
	}
	const segments = canonical.split('/');
	if (segments.length > 32 || segments.some((part) => part === '' || part === '.' || part === '..')) {
		throw new PackageFailure('invalid_archive');
	}
	return canonical;
}

export class NativePackageReader implements PackageReader {
	async read(
		bytes: Uint8Array,
		limits: { maxEntries: number; maxExpandedBytes: number; maxFileBytes: number },
	): Promise<ArchiveFile[]> {
		if (
			bytes.byteLength > 50 * 1024 * 1024 ||
			!bytes.byteLength ||
			!Number.isSafeInteger(limits.maxEntries) ||
			limits.maxEntries < 1 ||
			limits.maxEntries > 10000 ||
			!Number.isSafeInteger(limits.maxExpandedBytes) ||
			limits.maxExpandedBytes < 1 ||
			limits.maxExpandedBytes > 200 * 1024 * 1024 ||
			!Number.isSafeInteger(limits.maxFileBytes) ||
			limits.maxFileBytes < 1 ||
			limits.maxFileBytes > 50 * 1024 * 1024
		) {
			throw new PackageFailure('limit_exceeded');
		}
		// Bound the entire TAR representation, including metadata and padding, before parsing entries.
		const ceiling = limits.maxExpandedBytes + limits.maxEntries * 1024 + 1024 * 1024;
		let archive: Uint8Array = bytes;
		if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
			try {
				archive = await inflate(bytes, { maxOutputLength: ceiling });
			} catch (cause) {
				const tooLarge =
					cause !== null &&
					typeof cause === 'object' &&
					'code' in cause &&
					cause.code === 'ERR_BUFFER_TOO_LARGE';
				throw new PackageFailure(tooLarge ? 'limit_exceeded' : 'invalid_archive', { cause });
			}
		}
		if (archive.byteLength > ceiling) {
			throw new PackageFailure('limit_exceeded');
		}
		return new Promise((resolve, reject) => {
			const parser = new Parser({ strict: true, maxMetaEntrySize: 65536, maxDecompressionRatio: 1000 });
			const paths = new Map<string, 'file' | 'directory'>();
			const ancestors = new Set<string>();
			const files: ArchiveFile[] = [];
			let entries = 0,
				expanded = 0,
				failed = false;

			const fail = (error: unknown) => {
				if (failed) {
					return;
				}
				failed = true;
				const failure =
					error instanceof PackageFailure ? error : new PackageFailure('invalid_archive', { cause: error });
				parser.abort(failure);
				reject(failure);
			};

			parser.on('error', fail);
			parser.on('ignoredEntry', () => fail(new PackageFailure('invalid_archive')));
			parser.on('entry', (entry) => {
				try {
					if (++entries > limits.maxEntries) {
						throw new PackageFailure('limit_exceeded');
					}
					if (!['File', 'Directory'].includes(entry.type) || entry.linkpath) {
						throw new PackageFailure('invalid_archive');
					}
					const directory = entry.type === 'Directory',
						path = safePath(entry.path, directory);
					if (!path) {
						entry.resume();
						return;
					}
					if (paths.has(path)) {
						throw new PackageFailure('invalid_archive');
					}
					const segments = path.split('/');
					let ancestor = '';
					for (const segment of segments.slice(0, -1)) {
						ancestor = ancestor ? ancestor + '/' + segment : segment;
						if (paths.get(ancestor) === 'file') {
							throw new PackageFailure('invalid_archive');
						}
						ancestors.add(ancestor);
					}
					if (!directory && ancestors.has(path)) {
						throw new PackageFailure('invalid_archive');
					}
					paths.set(path, directory ? 'directory' : 'file');
					if (directory) {
						if (entry.size !== 0) {
							throw new PackageFailure('invalid_archive');
						}
						entry.resume();
						return;
					}
					if (
						!Number.isSafeInteger(entry.size) ||
						entry.size < 0 ||
						entry.size > limits.maxFileBytes ||
						expanded + entry.size > limits.maxExpandedBytes
					) {
						throw new PackageFailure('limit_exceeded');
					}
					expanded += entry.size;
					const chunks: Buffer[] = [];
					let received = 0;
					entry.on('error', fail);
					entry.on('data', (chunk: unknown) => {
						if (!Buffer.isBuffer(chunk)) {
							fail(new PackageFailure('invalid_archive'));
							return;
						}
						received += chunk.byteLength;
						if (received > entry.size) {
							fail(new PackageFailure('invalid_archive'));
							return;
						}
						chunks.push(chunk);
					});
					entry.on('end', () => {
						if (received !== entry.size) {
							fail(new PackageFailure('invalid_archive'));
							return;
						}
						const content = Buffer.concat(chunks, received);
						files.push({
							path,
							bytes: Uint8Array.from(content),
							sha256: createHash('sha256').update(content).digest('hex'),
						});
					});
				} catch (error) {
					entry.resume();
					fail(error);
				}
			});
			parser.on('end', () => {
				if (!failed) {
					resolve(files);
				}
			});
			try {
				parser.end(Buffer.from(archive));
			} catch (error) {
				fail(error);
			}
		});
	}
}
