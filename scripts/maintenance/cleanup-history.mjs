/** Manual repository maintenance. No product data or unrelated packages are touched. */
export default async function cleanup({ github, context, core }) {
	const { owner, repo } = context.repo;
	const repository = await github.rest.repos.get({ owner, repo });
	const organization = repository.data.owner.type === 'Organization';
	const packageOwner = organization ? { org: owner } : { username: owner };
	const packageRoute = organization ? '/orgs/{org}' : '/users/{username}';
	const packagePath = `${packageRoute}/packages/container/{package_name}/versions`;
	const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, { owner, repo, per_page: 100 });
	const currentRun = Number(context.runId);
	const activeRuns = runs.filter((run) => run.id !== currentRun && run.status !== 'completed');
	for (const run of activeRuns) core.info(`Keep active run ${run.id}: ${run.status}`);

	const protectedTags = ['main', 'dev', 'latest'];
	const retainedRevisions = new Set();

	async function inspectPackage(packageName) {
		let metadata;
		try {
			metadata = await github.request(`GET ${packageRoute}/packages/container/{package_name}`, {
				...packageOwner,
				package_name: packageName,
			});
		} catch (error) {
			if (error.status === 404) return null;
			throw error;
		}
		if (!Number.isSafeInteger(repository.data.id) || metadata.data.repository?.id !== repository.data.id) {
			throw new Error(`Package ${packageName} is not linked to this repository; refusing cleanup.`);
		}
		const versions = await github.paginate(`GET ${packagePath}`, {
			...packageOwner,
			package_name: packageName,
			per_page: 100,
		});
		if (!versions.length) return null;
		const channels = new Map();
		for (const tag of protectedTags) {
			const matches = versions.filter((item) => item.metadata.container.tags.includes(tag));
			if (matches.length > 1) throw new Error(`Ambiguous ${packageName}:${tag} image; refusing cleanup.`);
			if (matches.length) channels.set(tag, matches[0]);
		}
		if (!channels.size) throw new Error(`No main/dev/latest root for ${packageName}; refusing cleanup.`);

		const image = `${owner.toLowerCase()}/${packageName}`;
		const tokenResponse = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${image}:pull`, {
			headers: {
				Authorization: `Basic ${Buffer.from(`${context.actor}:${process.env.GITHUB_TOKEN}`).toString('base64')}`,
			},
		});
		if (!tokenResponse.ok) throw new Error(`Registry authentication failed: HTTP ${tokenResponse.status}`);
		const { token } = await tokenResponse.json();
		if (typeof token !== 'string' || !token) throw new Error('Registry did not return a pull token.');
		core.setSecret(token);
		const headers = {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
		};
		const retainedDigests = new Set();

		async function retainManifest(digest) {
			if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid manifest digest.');
			if (retainedDigests.has(digest)) return;
			retainedDigests.add(digest);
			const response = await fetch(`https://ghcr.io/v2/${image}/manifests/${digest}`, { headers });
			if (!response.ok) throw new Error(`Cannot inspect retained manifest: HTTP ${response.status}`);
			const manifest = await response.json();
			if (Array.isArray(manifest.manifests)) {
				for (const child of manifest.manifests) await retainManifest(child.digest);
			} else if (manifest.config?.digest) {
				if (!/^sha256:[a-f0-9]{64}$/.test(manifest.config.digest)) throw new Error('Invalid config digest.');
				const configResponse = await fetch(`https://ghcr.io/v2/${image}/blobs/${manifest.config.digest}`, {
					headers,
				});
				if (!configResponse.ok)
					throw new Error(`Cannot inspect retained image config: HTTP ${configResponse.status}`);
				const config = await configResponse.json();
				const revision = config.config?.Labels?.['org.opencontainers.image.revision'];
				if (typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision)) retainedRevisions.add(revision);
			} else {
				throw new Error('Unrecognized retained manifest; refusing partial retention.');
			}
		}

		for (const version of channels.values()) await retainManifest(version.name);

		async function verifyChannels() {
			// Also check absent protected tags: creating main/dev/latest must stop a stale deletion plan.
			for (const tag of protectedTags) {
				const version = channels.get(tag);
				const response = await fetch(`https://ghcr.io/v2/${image}/manifests/${tag}`, {
					method: 'HEAD',
					headers,
				});
				if (!version && response.status === 404) continue;
				if (!response.ok || response.headers.get('docker-content-digest') !== version?.name) {
					throw new Error('A channel moved during cleanup. Stop and rerun against the new images.');
				}
			}
		}

		return {
			name: packageName,
			channels,
			obsoleteVersions: versions.filter((version) => !retainedDigests.has(version.name)),
			verifyChannels,
		};
	}

	const packages = [];
	for (const name of ['nexus-terminal', 'nexus-terminal-e2e-runner']) {
		const inspected = await inspectPackage(name);
		if (inspected) packages.push(inspected);
	}

	// Recheck both packages before every image deletion; package DELETE has no conditional digest guard.
	async function verifyChannels() {
		for (const item of packages) await item.verifyChannels();
	}

	await verifyChannels();
	const retainedRuns = new Set([currentRun, ...activeRuns.map((run) => run.id)]);
	for (const run of runs) {
		if (retainedRevisions.has(run.head_sha) && run.conclusion === 'success') retainedRuns.add(run.id);
	}
	// A timing-only bot commit may separate a published revision from its verified E2E source.
	const newestGreenE2e = runs.find((run) => run.path === '.github/workflows/e2e.yml' && run.conclusion === 'success');
	if (newestGreenE2e) retainedRuns.add(newestGreenE2e.id);
	const artifacts = await github.paginate(github.rest.actions.listArtifactsForRepo, { owner, repo, per_page: 100 });
	const caches = await github.paginate(github.rest.actions.getActionsCacheList, { owner, repo, per_page: 100 });
	const obsoleteImages = packages.find((item) => item.name === 'nexus-terminal')?.obsoleteVersions ?? [];
	const obsoleteRunnerVersions =
		packages.find((item) => item.name === 'nexus-terminal-e2e-runner')?.obsoleteVersions ?? [];
	const obsoleteRuns = runs.filter((run) => !retainedRuns.has(run.id));
	const obsoleteArtifacts = artifacts.filter((artifact) => !retainedRuns.has(artifact.workflow_run?.id));
	core.info(
		`Plan: delete ${obsoleteImages.length} product versions, ${obsoleteRunnerVersions.length} runner versions, ${obsoleteRuns.length} runs, ${obsoleteArtifacts.length} artifacts and ${caches.length} caches.`,
	);
	for (const item of packages) {
		for (const [tag, version] of item.channels) core.info(`Keep ${item.name}:${tag}: ${version.name}`);
	}

	let alreadyAbsent = 0;

	async function deleteIfPresent(description, remove) {
		try {
			await remove();
			return true;
		} catch (error) {
			// DELETE may have committed before a transient error triggered a retry.
			// Only the exact resource's absence is an idempotent success.
			if (error?.status !== 404) {
				throw error;
			}
			core.info(`Already absent: ${description}.`);
			alreadyAbsent += 1;
			return false;
		}
	}

	async function currentRunState(runId) {
		try {
			return (await github.rest.actions.getWorkflowRun({ owner, repo, run_id: runId })).data;
		} catch (error) {
			if (error?.status !== 404) {
				throw error;
			}
			return null;
		}
	}

	let deletedArtifacts = 0;
	let deletedRuns = 0;
	for (const artifact of obsoleteArtifacts) {
		const runId = artifact.workflow_run?.id;
		if (!runId) {
			core.info(`Keep artifact ${artifact.id}: owning run is unavailable.`);
			continue;
		}
		const fresh = await currentRunState(runId);
		if (!fresh) {
			core.info(`Keep artifact ${artifact.id}: run ${runId} is no longer available for verification.`);
			continue;
		}
		if (fresh.status !== 'completed') {
			core.info(`Keep artifact ${artifact.id}: run ${runId} is ${fresh.status}.`);
			continue;
		}
		if (
			await deleteIfPresent(`artifact ${artifact.id}`, () =>
				github.rest.actions.deleteArtifact({ owner, repo, artifact_id: artifact.id }),
			)
		) {
			deletedArtifacts += 1;
		}
	}
	for (const run of obsoleteRuns) {
		const fresh = await currentRunState(run.id);
		if (!fresh) {
			core.info(`Keep run ${run.id}: already unavailable.`);
			continue;
		}
		if (fresh.status !== 'completed') {
			core.info(`Keep restarted run ${run.id}: ${fresh.status}`);
			continue;
		}
		if (
			await deleteIfPresent(`run ${run.id}`, () =>
				github.rest.actions.deleteWorkflowRun({ owner, repo, run_id: run.id }),
			)
		) {
			deletedRuns += 1;
		}
	}
	const freshRuns = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
		owner,
		repo,
		per_page: 100,
	});
	const hasActiveRuns = freshRuns.some((run) => run.id !== currentRun && run.status !== 'completed');
	const removableCaches = hasActiveRuns ? [] : caches;
	const removableImages = hasActiveRuns ? [] : obsoleteImages;
	const removableRunnerVersions = hasActiveRuns ? [] : obsoleteRunnerVersions;
	if (hasActiveRuns) core.info('Other runs are active; keep image versions and Actions caches for this cleanup.');
	let deletedCaches = 0;
	let deletedImages = 0;
	let deletedRunnerVersions = 0;
	for (const cache of removableCaches) {
		if (
			await deleteIfPresent(`cache ${cache.id}`, () =>
				github.rest.actions.deleteActionsCacheById({ owner, repo, cache_id: cache.id }),
			)
		) {
			deletedCaches += 1;
		}
	}
	for (const [packageName, candidates] of [
		['nexus-terminal', removableImages],
		['nexus-terminal-e2e-runner', removableRunnerVersions],
	]) {
		for (const version of candidates) {
			await verifyChannels();
			const removed = await deleteIfPresent(`${packageName} version ${version.id}`, () =>
				github.request(`DELETE ${packagePath}/{package_version_id}`, {
					...packageOwner,
					package_name: packageName,
					package_version_id: version.id,
					// Retrying here would bypass verifyChannels after the backoff.
					request: { retries: 0 },
				}),
			);
			if (removed) {
				if (packageName === 'nexus-terminal') {
					deletedImages += 1;
				} else {
					deletedRunnerVersions += 1;
				}
			}
		}
	}
	await verifyChannels();
	await core.summary
		.addHeading('Manual cleanup complete')
		.addRaw(
			'Kept existing main/dev/latest roots in nexus-terminal and nexus-terminal-e2e-runner, all referenced platform/attestation manifests, their successful runs, the newest successful E2E and this cleanup run. Removed eligible completed runs/artifacts. Active or restarted runs and their artifacts were retained; image versions and caches were retained when other runs were active.\n',
		)
		.addTable([
			['Deleted resource', 'Count'],
			['Product image versions', String(deletedImages)],
			['Runner image versions', String(deletedRunnerVersions)],
			['Actions runs', String(deletedRuns)],
			['Artifacts', String(deletedArtifacts)],
			['Actions caches', String(deletedCaches)],
			['Already absent (not counted as deleted)', String(alreadyAbsent)],
		])
		.write();
}
