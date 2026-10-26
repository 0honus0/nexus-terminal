import path from 'node:path';
import { RemoteFileFailure } from './model/file-types.js';
import {
	ArchiveRejection,
	type ArchiveFormat,
	type FileArchiveMember,
	type FileArchiveEntry,
	type FileArchiveLinkTarget,
	type FileArchiveHardlink,
} from './model/file-task-types.js';

export const ARCHIVE_UNSAFE_CHARACTER = /[\x00-\x1f\x7f]/u;

/** Interpret a native listing only when it agrees with the independently
 * generated verbose metadata. In particular, filenames with embedded line
 * breaks and device or privileged entries are rejected.
 */
export function validateListing(
	names: readonly string[],
	modes: readonly FileArchiveMember[],
	format: ArchiveFormat,
	archive: string,
): Map<string, FileArchiveEntry> {
	if (names.length !== modes.length) {
		throw new RemoteFileFailure('invalid_input');
	}
	const members = new Map<string, FileArchiveEntry>();
	for (let i = 0; i < names.length; i++) {
		const raw = names[i];
		const metadata = modes[i];
		if (!raw || !metadata) {
			throw new RemoteFileFailure('invalid_input');
		}
		if (metadata.kind === 'special' || (metadata.mode !== null && (metadata.mode & 0o6000) !== 0)) {
			throw new ArchiveRejection('UNSUPPORTED_ENTRY');
		}
		if (raw !== metadata.name) {
			throw new RemoteFileFailure('invalid_input');
		}
		if (
			!raw ||
			raw.startsWith('/') ||
			raw.includes('\\') ||
			ARCHIVE_UNSAFE_CHARACTER.test(raw) ||
			Buffer.byteLength(raw, 'utf8') > 4096
		) {
			throw new RemoteFileFailure('invalid_input');
		}
		let name = raw;
		while (format !== 'zip' && name.startsWith('./')) {
			name = name.slice(2);
		}
		if (name === '' && raw === './' && metadata.kind === 'directory') {
			continue;
		}
		const parts = name.replace(/\/$/u, '').split('/');
		if (parts.some((p) => !p || p === '.' || p === '..')) {
			throw new RemoteFileFailure('invalid_input');
		}
		name = parts.join('/');
		if (members.has(name) || name === path.posix.basename(archive)) {
			throw new RemoteFileFailure('invalid_input');
		}
		members.set(name, {
			kind: metadata.kind === 'hardlink' ? 'file' : metadata.kind,
			hardlink: metadata.kind === 'hardlink',
			size: metadata.size,
			mode: metadata.mode,
			rawName: raw,
			linkTarget: metadata.linkTarget,
		});
	}
	for (const [name] of members) {
		const components = name.split('/');
		for (let i = 1; i < components.length; i++) {
			const parentName = components.slice(0, i).join('/');
			const parent = members.get(parentName);
			if (parent && parent.kind !== 'directory') {
				throw new RemoteFileFailure('invalid_input');
			}
		}
	}
	return members;
}

/** Resolve leaf link chains without collapsing unchecked directory traversal. */
export function resolveLinkTargets(members: ReadonlyMap<string, FileArchiveEntry>): Map<string, FileArchiveLinkTarget> {
	const targets = new Map<string, FileArchiveLinkTarget>();
	for (const [name, member] of members) {
		if (member.kind !== 'symlink') {
			continue;
		}
		const visited = new Set<string>();
		const directories = new Set<string>();
		let current = name;
		let link: FileArchiveEntry | undefined = member;
		while (link?.kind === 'symlink') {
			if (visited.has(current)) {
				throw new RemoteFileFailure('invalid_input');
			}
			visited.add(current);
			const target = link.linkTarget;
			if (
				!target ||
				target.startsWith('/') ||
				target.includes('\\') ||
				ARCHIVE_UNSAFE_CHARACTER.test(target) ||
				Buffer.byteLength(target, 'utf8') > 4096
			) {
				throw new RemoteFileFailure('invalid_input');
			}
			const directory = path.posix.dirname(current);
			const components = directory === '.' ? [] : directory.split('/');
			const parts = target.split('/');
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				if (part === '..') {
					if (!components.length) {
						throw new RemoteFileFailure('invalid_input');
					}
					components.pop();
				} else if (part && part !== '.') {
					components.push(part);
				}
				const traversed = components.join('/') || '.';
				if (i < parts.length - 1) {
					const ancestor = members.get(traversed);
					if (ancestor && ancestor.kind !== 'directory') {
						throw new RemoteFileFailure('invalid_input');
					}
					directories.add(traversed);
				}
			}
			current = components.join('/') || '.';
			link = members.get(current);
		}
		targets.set(name, { destination: current, directories: [...directories] });
	}
	return targets;
}

/** TAR hardlink targets are archive-root-relative and must end at a declared ordinary file. */
export function resolveHardlinkTargets(
	members: ReadonlyMap<string, FileArchiveEntry>,
): Map<string, FileArchiveHardlink> {
	const targets = new Map<string, FileArchiveHardlink>();
	for (const [name, member] of members) {
		if (member.hardlink) {
			const visited = new Set([name]);
			let link = member;
			let target = name;
			while (link.hardlink) {
				const raw = link.linkTarget;
				if (
					!raw ||
					raw.startsWith('/') ||
					raw.includes('\\') ||
					ARCHIVE_UNSAFE_CHARACTER.test(raw) ||
					Buffer.byteLength(raw, 'utf8') > 4096
				) {
					throw new RemoteFileFailure('invalid_input');
				}
				let normalized = raw;
				while (normalized.startsWith('./')) {
					normalized = normalized.slice(2);
				}
				if (
					normalized.split('/').some((part) => !part || part === '.' || part === '..') ||
					visited.has(normalized)
				) {
					throw new RemoteFileFailure('invalid_input');
				}
				visited.add(normalized);
				const next = members.get(normalized);
				if (!next || next.kind !== 'file') {
					throw new RemoteFileFailure('invalid_input');
				}
				link = next;
				target = normalized;
			}
			if (member.mode !== link.mode) {
				throw new RemoteFileFailure('invalid_input');
			}
			targets.set(name, { target, size: link.size });
		}
	}
	return targets;
}
