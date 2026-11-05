/** Manual repository maintenance. No product data or unrelated packages are touched. */
export default async function cleanup({ github, context, core }) {
	const { owner, repo } = context.repo;
	const repository = await github.rest.repos.get({ owner, repo });
	const organization = repository.data.owner.type === 'Organization';
	const packageOwner = organization ? { org: owner } : { username: owner };
	const packageRoute = organization ? '/orgs/{org}' : '/users/{username}';
	const packagePath = `${packageRoute}/packages/container/{package_name}/versions`;
	const currentRun = Number(context.runId);
	core.info(`Cleanup started for ${owner}/${repo}; current run ${currentRun}.`);

	async function phase(name, work) {
		core.startGroup(name);
		const startedAt = Date.now();
		try {
			const result = await work();
			core.info(`${name} finished in ${Date.now() - startedAt} ms.`);
			return result;
		} catch (error) {
			core.warning(`${name} failed after ${Date.now() - startedAt} ms.`);
			throw error;
		} finally {
			core.endGroup();
		}
	}

	function expiredQueuedRun(run) {
		if (
			run.status !== 'queued' ||
			run.conclusion !== null ||
			!Number.isSafeInteger(run.run_attempt) ||
			run.run_attempt < 1
		) {
			return false;
		}
		const timestamps = [run.created_at, run.updated_at, run.run_started_at];
		if (!timestamps.every((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)))) {
			return false;
		}
		// GitHub's workflow lifetime includes waiting and approval: https://docs.github.com/en/actions/reference/limits
		const workflowLifetimeMs = 35 * 24 * 60 * 60 * 1000;
		return Date.now() - Math.max(...timestamps.map((value) => Date.parse(value))) > workflowLifetimeMs;
	}

	async function isStaleQueuedRun(run) {
		if (!expiredQueuedRun(run)) {
			return false;
		}
		const fresh = await currentRunState(run.id);
		if (!fresh || fresh.id !== run.id || !expiredQueuedRun(fresh)) {
			return false;
		}
		let jobs;
		try {
			jobs = await github.rest.actions.listJobsForWorkflowRun({
				owner,
				repo,
				run_id: run.id,
				filter: 'all',
				per_page: 1,
			});
		} catch (error) {
			if (error?.status !== 404) {
				throw error;
			}
			core.warning(`Keep run ${run.id} active: all-attempt job metadata is unavailable.`);
			return false;
		}
		if (jobs.data.total_count !== 0 || !Array.isArray(jobs.data.jobs) || jobs.data.jobs.length !== 0) {
			return false;
		}
		const verified = await currentRunState(run.id);
		return (
			verified?.id === run.id &&
			expiredQueuedRun(verified) &&
			verified.run_attempt === fresh.run_attempt &&
			verified.created_at === fresh.created_at &&
			verified.updated_at === fresh.updated_at &&
			verified.run_started_at === fresh.run_started_at
		);
	}

	async function classifyUnfinishedRuns(runs) {
		const active = [];
		const staleQueued = [];
		for (const run of runs) {
			if (run.id === currentRun || run.status === 'completed') {
				continue;
			}
			if (await isStaleQueuedRun(run)) {
				staleQueued.push(run);
				core.warning(
					`Ignore stale queued run ${run.id} as a cleanup blocker: all attempts have zero jobs and activity is older than GitHub's 35-day workflow lifetime (updated ${run.updated_at}). Keep its record and artifacts.`,
				);
			} else {
				active.push(run);
				core.info(
					`Keep active run ${run.id}: ${run.status}; branch=${run.head_branch ?? 'unknown'}, attempt=${run.run_attempt ?? 'unknown'}, updated=${run.updated_at ?? 'unknown'}.`,
				);
			}
		}
		core.info(
			`Inspected ${runs.length} runs: ${active.length} active blockers, ${staleQueued.length} stale queued records.`,
		);
		return { active, staleQueued };
	}

	const runs = await phase('Inspect Actions runs', () =>
		github.paginate(github.rest.actions.listWorkflowRunsForRepo, { owner, repo, per_page: 100 }),
	);
	const initialRuns = await phase('Classify unfinished runs', () => classifyUnfinishedRuns(runs));

	const protectedTags = ['main', 'dev', 'latest'];
	const retainedRevisions = new Set();

	async function inspectPackage(packageName) {
		core.info(`Inspect package ${packageName}: checking repository ownership and published versions.`);
		let metadata;
		try {
			metadata = await github.request(`GET ${packageRoute}/packages/container/{package_name}`, {
				...packageOwner,
				package_name: packageName,
			});
		} catch (error) {
			if (error.status === 404) {
				core.info(`Skip package ${packageName}: not published.`);
				return null;
			}
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
		if (!versions.length) {
			core.info(`Skip package ${packageName}: no versions.`);
			return null;
		}
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
		core.info(
			`Package ${packageName}: ${versions.length} versions, ${channels.size} protected tags, ${retainedDigests.size} retained manifests, ${versions.filter((version) => !retainedDigests.has(version.name)).length} deletion candidates.`,
		);

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

	const packages = await phase('Inspect protected images', async () => {
		const inspectedPackages = [];
		for (const name of ['nexus-terminal', 'nexus-terminal-e2e-runner']) {
			const inspected = await inspectPackage(name);
			if (inspected) {
				inspectedPackages.push(inspected);
			}
		}
		return inspectedPackages;
	});

	// Recheck both packages before every image deletion; package DELETE has no conditional digest guard.
	async function verifyChannels() {
		for (const item of packages) await item.verifyChannels();
	}

	await verifyChannels();
	const retainedRuns = new Set([
		currentRun,
		...initialRuns.active.map((run) => run.id),
		...initialRuns.staleQueued.map((run) => run.id),
	]);
	for (const run of runs) {
		if (retainedRevisions.has(run.head_sha) && run.conclusion === 'success') {
			retainedRuns.add(run.id);
			core.info(`Keep run ${run.id}: successful evidence for protected image revision ${run.head_sha}.`);
		}
	}
	// A timing-only bot commit may separate a published revision from its verified E2E source.
	const newestGreenE2e = runs.find((run) => run.path === '.github/workflows/e2e.yml' && run.conclusion === 'success');
	if (newestGreenE2e) {
		retainedRuns.add(newestGreenE2e.id);
		core.info(`Keep run ${newestGreenE2e.id}: newest successful E2E.`);
	}
	const artifacts = await phase('Inspect Actions artifacts', () =>
		github.paginate(github.rest.actions.listArtifactsForRepo, { owner, repo, per_page: 100 }),
	);
	const caches = await phase('Inspect Actions caches', () =>
		github.paginate(github.rest.actions.getActionsCacheList, { owner, repo, per_page: 100 }),
	);
	const obsoleteImages = packages.find((item) => item.name === 'nexus-terminal')?.obsoleteVersions ?? [];
	const obsoleteRunnerVersions =
		packages.find((item) => item.name === 'nexus-terminal-e2e-runner')?.obsoleteVersions ?? [];
	const obsoleteRuns = runs.filter((run) => !retainedRuns.has(run.id));
	const obsoleteArtifacts = artifacts.filter((artifact) => !retainedRuns.has(artifact.workflow_run?.id));
	core.info(
		`Keep ${retainedRuns.size} run records and ${artifacts.length - obsoleteArtifacts.length} associated artifacts.`,
	);
	core.info(
		`Plan: delete ${obsoleteImages.length} product versions, ${obsoleteRunnerVersions.length} runner versions, ${obsoleteRuns.length} runs, ${obsoleteArtifacts.length} artifacts and ${caches.length} caches.`,
	);
	for (const item of packages) {
		for (const [tag, version] of item.channels) {
			core.info(`Keep ${item.name}:${tag}: ${version.name}`);
		}
	}

	let alreadyAbsent = 0;
	let deletedArtifacts = 0;
	let deletedRuns = 0;
	let deletedCaches = 0;
	let deletedImages = 0;
	let deletedRunnerVersions = 0;
	let skippedArtifacts = 0;
	let skippedRuns = 0;
	let hasActiveRuns = false;
	let finalRuns = initialRuns;

	function logDeletedCounts() {
		core.info(
			`Confirmed deletions: product=${deletedImages}, runner=${deletedRunnerVersions}, runs=${deletedRuns}, artifacts=${deletedArtifacts}, caches=${deletedCaches}; already absent=${alreadyAbsent}.`,
		);
	}

	async function deleteIfPresent(description, remove) {
		const startedAt = Date.now();
		core.info(`Delete starting: ${description}.`);
		try {
			await remove();
			core.info(`Delete confirmed: ${description} (${Date.now() - startedAt} ms).`);
			return true;
		} catch (error) {
			// DELETE may have committed before a transient error triggered a retry.
			// Only the exact resource's absence is an idempotent success.
			if (error?.status !== 404) {
				core.warning(
					`Delete failed: ${description}; HTTP ${error?.status ?? 'unknown'}. Stopping cleanup; this resource may already have been deleted.`,
				);
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

	try {
		await phase('Clean obsolete artifacts', async () => {
			for (const [index, artifact] of obsoleteArtifacts.entries()) {
				const runId = artifact.workflow_run?.id;
				core.info(
					`Artifact ${index + 1}/${obsoleteArtifacts.length}: id=${artifact.id}, checking run ${runId ?? 'unknown'}.`,
				);
				if (!runId) {
					skippedArtifacts += 1;
					core.info(`Keep artifact ${artifact.id}: owning run is unavailable.`);
					continue;
				}
				const fresh = await currentRunState(runId);
				if (!fresh) {
					skippedArtifacts += 1;
					core.info(`Keep artifact ${artifact.id}: run ${runId} is no longer available for verification.`);
					continue;
				}
				if (fresh.status !== 'completed') {
					skippedArtifacts += 1;
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
		});
		logDeletedCounts();
		await phase('Clean obsolete runs', async () => {
			for (const [index, run] of obsoleteRuns.entries()) {
				core.info(`Run ${index + 1}/${obsoleteRuns.length}: id=${run.id}, checking current state.`);
				const fresh = await currentRunState(run.id);
				if (!fresh) {
					skippedRuns += 1;
					core.info(`Keep run ${run.id}: already unavailable.`);
					continue;
				}
				if (fresh.status !== 'completed') {
					skippedRuns += 1;
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
		});
		logDeletedCounts();
		finalRuns = await phase('Recheck unfinished runs before image and cache deletion', async () => {
			const freshRuns = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
				owner,
				repo,
				per_page: 100,
			});
			return classifyUnfinishedRuns(freshRuns);
		});
		hasActiveRuns = finalRuns.active.length > 0;
		const removableCaches = hasActiveRuns ? [] : caches;
		const removableImages = hasActiveRuns ? [] : obsoleteImages;
		const removableRunnerVersions = hasActiveRuns ? [] : obsoleteRunnerVersions;
		if (hasActiveRuns) {
			core.warning(
				`Other runs are active (${finalRuns.active.map((run) => run.id).join(', ')}); defer ${obsoleteImages.length} product versions, ${obsoleteRunnerVersions.length} runner versions and ${caches.length} caches. Rerun after they finish.`,
			);
		}
		await phase('Clean Actions caches', async () => {
			for (const [index, cache] of removableCaches.entries()) {
				core.info(`Cache ${index + 1}/${removableCaches.length}: id=${cache.id}.`);
				if (
					await deleteIfPresent(`cache ${cache.id}`, () =>
						github.rest.actions.deleteActionsCacheById({ owner, repo, cache_id: cache.id }),
					)
				) {
					deletedCaches += 1;
				}
			}
		});
		logDeletedCounts();
		for (const [packageName, candidates] of [
			['nexus-terminal', removableImages],
			['nexus-terminal-e2e-runner', removableRunnerVersions],
		]) {
			await phase(`Clean image versions: ${packageName}`, async () => {
				for (const [index, version] of candidates.entries()) {
					core.info(
						`Image ${index + 1}/${candidates.length}: ${packageName} version=${version.id}, digest=${version.name}, tags=${version.metadata.container.tags.join(',') || '(untagged)'}; rechecking protected tags.`,
					);
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
			});
			logDeletedCounts();
		}
		await phase('Verify protected image tags after cleanup', verifyChannels);
	} catch (error) {
		logDeletedCounts();
		throw error;
	}
	const deferredImages = hasActiveRuns ? obsoleteImages.length : 0;
	const deferredRunnerVersions = hasActiveRuns ? obsoleteRunnerVersions.length : 0;
	const deferredCaches = hasActiveRuns ? caches.length : 0;
	const deferred = deferredImages + deferredRunnerVersions + deferredCaches > 0;
	core.info(
		`Cleanup finished${deferred ? ' with deferred image/cache deletion' : ''}; stale queued records ignored=${finalRuns.staleQueued.length}.`,
	);
	await core.summary
		.addHeading(deferred ? 'Cleanup finished with deferred deletions' : 'Manual cleanup complete')
		.addRaw(
			`Kept main/dev/latest and their manifest closure, successful evidence, newest green E2E and this run. Active/restarted runs and all retained artifacts remain protected. ${finalRuns.staleQueued.length} stale queued records do not block cleanup and were not deleted. ${deferred ? 'Image/cache cleanup was deferred because other runs are active; rerun after they finish.' : 'Image/cache cleanup was not deferred.'}\n`,
		)
		.addTable([
			['Resource', 'Deleted', 'Planned candidates', 'Deferred / kept after recheck'],
			['Product image versions', String(deletedImages), String(obsoleteImages.length), String(deferredImages)],
			[
				'Runner image versions',
				String(deletedRunnerVersions),
				String(obsoleteRunnerVersions.length),
				String(deferredRunnerVersions),
			],
			['Actions runs', String(deletedRuns), String(obsoleteRuns.length), String(skippedRuns)],
			['Artifacts', String(deletedArtifacts), String(obsoleteArtifacts.length), String(skippedArtifacts)],
			['Actions caches', String(deletedCaches), String(caches.length), String(deferredCaches)],
			['Already absent (not counted as deleted)', String(alreadyAbsent), '—', '—'],
		])
		.write();
}
