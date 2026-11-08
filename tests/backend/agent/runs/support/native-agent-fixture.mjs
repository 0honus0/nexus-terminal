import { installSignedAgentApp } from '../../../../support/plugins/install-signed-app.mjs';
import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPinnedPluginPackage, pinnedExecutionFixture } from '../../../../support/pinned-plugin-package.mjs';
import { buildNativePluginPackage } from '../../../../support/native-plugin-package.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

/** Installs through the ordinary trust, repository, verification and installation flow. */
export async function createTestAgentApp(api, directory, name, options = {}) {
	if (options.signedPackages) {
		return installSignedAgentApp(api, options.signedPackages, {
			packageId: options.packageId,
			selectedRootIds: options.selectedRootIds,
			uiPackageId: options.uiPackageId,
		});
	}
	let signingKeyPath = options.signingKeyPath;
	if (!signingKeyPath) {
		signingKeyPath = join(directory, 'native-publisher.pem');
		try {
			await readFile(signingKeyPath);
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
			const { privateKey } = generateKeyPairSync('ed25519');
			await writeFile(signingKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
		}
	}
	const existingPackages = expectStatus(await api('GET', '/api/v1/agent/plugins/packages'), 200);
	const neededIds = options.selectedRootIds ?? [
		'nexus.tools.remote',
		'nexus.tools.browser',
		'nexus.tools.integrations',
		'nexus.tools.agent',
	];
	const useModelApp =
		options.backend === undefined && options.contribution === undefined && options.deterministic !== true;
	const uiPackageId =
		options.uiPackageId === undefined ? (useModelApp ? 'nexus.ui.chat' : null) : options.uiPackageId;
	const dependencies = [];
	for (const packageId of [...new Set([...neededIds, ...(uiPackageId ? [uiPackageId] : [])])]) {
		const existing = existingPackages.installations.find(
			(entry) => entry.packageId === packageId && entry.status === 'installed',
		);
		if (!existing) dependencies.push(await buildPinnedPluginPackage(directory, packageId));
	}
	const execution = useModelApp ? await pinnedExecutionFixture() : {};
	const main = await buildNativePluginPackage(directory, name, signingKeyPath, {
		...execution,
		...options,
		dependencies: options.dependencies ?? [],
	});
	return installSignedAgentApp(api, [...dependencies, main], {
		packageId: main.metadata.packageId,
		selectedRootIds: neededIds,
		uiPackageId,
	});
}
