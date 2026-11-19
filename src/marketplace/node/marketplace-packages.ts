import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import pacote from 'pacote';
import { inspectPluginPackage } from '../../plugin/plugin-api.node.js';
import { CodedError } from '../../utils/error.js';
import type { MarketplaceInstallStep } from '../marketplace-install-types.js';

const packageName = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

export class MarketplacePackages {
	readonly #directory: string;

	constructor(directory: string) {
		this.#directory = resolve(directory);
	}

	async prepare(step: MarketplaceInstallStep, signal: AbortSignal): Promise<string> {
		const { distribution, package: manifest } = step;
		if (!distribution) throw new CodedError('MARKETPLACE_PACKAGE_INVALID');
		signal.throwIfAborted();
		await mkdir(this.#directory, { recursive: true, mode: 0o700 });
		const root = await realpath(this.#directory);
		const staging = join(root, '.staging-' + randomUUID());
		const destination = join(root, randomUUID());
		try {
			try {
				await pacote.extract(distribution.tarball, staging, {
					integrity: distribution.integrity,
					ignoreScripts: true,
					fetchRetries: 0,
					fetchTimeout: 30_000,
					cache: join(this.#directory, '.cache'),
					signal,
				});
			} catch (cause) {
				signal.throwIfAborted();
				const code = (cause as NodeJS.ErrnoException)?.code;
				throw new CodedError(
					code === 'EINTEGRITY' || code?.startsWith('TAR_')
						? 'MARKETPLACE_PACKAGE_INVALID'
						: 'MARKETPLACE_PLUGIN_FETCH_FAILED',
					{ cause },
				);
			}
			signal.throwIfAborted();
			const actual = await inspectPluginPackage(staging).catch((cause: unknown) => {
				throw new CodedError('MARKETPLACE_PACKAGE_INVALID', { cause });
			});

			const identity = ({
				name,
				version,
				type,
				peerDependencies,
				engines,
				os,
				cpu,
				libc,
				nexus,
			}: typeof manifest) => ({ name, version, type, peerDependencies, engines, os, cpu, libc, nexus });

			if (!isDeepStrictEqual(identity(actual.package), identity(manifest)))
				throw new CodedError('MARKETPLACE_PACKAGE_IDENTITY_MISMATCH');

			signal.throwIfAborted();
			await rename(staging, destination);
			return destination;
		} catch (cause) {
			await rm(staging, { recursive: true, force: true });
			throw cause;
		}
	}

	/** 重启后回收未提交的临时目录和已经被替换的产物。 */
	async collect(installed: readonly string[], signal: AbortSignal): Promise<void> {
		await mkdir(this.#directory, { recursive: true, mode: 0o700 });
		const root = await realpath(this.#directory);
		const keep = new Set(installed);
		for (const entry of await readdir(root, { withFileTypes: true })) {
			signal.throwIfAborted();
			if (!entry.isDirectory() || !packageName.test(entry.name.replace(/^\.staging-/u, ''))) continue;
			const path = join(root, entry.name);
			if (!keep.has(path)) await rm(path, { recursive: true, force: true });
		}
	}

	/** 只删除市场生成的产物目录。本地开发包和目录根均不属于市场。 */
	async remove(path: string): Promise<void> {
		const directory = resolve(path);
		if (!packageName.test(basename(directory))) return;
		const root = await realpath(this.#directory);
		if (dirname(directory) === root) await rm(directory, { recursive: true, force: true });
	}
}
