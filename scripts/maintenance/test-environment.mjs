import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveBuildArtifact } from '../e2e/resolve-build-artifact.mjs';

const execute = promisify(execFile);

export async function readTestEnvironment({ github, owner, repo, run }) {
	const artifactId = Number(
		await resolveBuildArtifact({ github, owner, repo, runId: run.id, sha: run.head_sha, kind: 'environment' }),
	);
	const { data: artifact } = await github.rest.actions.getArtifact({ owner, repo, artifact_id: artifactId });
	assert.equal(artifact.id, artifactId, 'Test environment artifact identity changed');
	assert.equal(artifact.expired, false, 'Test environment artifact expired');
	const { data } = await github.rest.actions.downloadArtifact({
		owner,
		repo,
		artifact_id: artifactId,
		archive_format: 'zip',
	});
	assert.ok(data instanceof ArrayBuffer || Buffer.isBuffer(data), 'Invalid test environment archive');
	const bytes = Buffer.from(data);
	assert.equal(
		'sha256:' + createHash('sha256').update(bytes).digest('hex'),
		artifact.digest,
		'Test environment archive digest differs',
	);
	const directory = await mkdtemp(join(tmpdir(), 'nexus-cleanup-environment-'));
	let failure;
	try {
		const archive = join(directory, 'environment.zip');
		await writeFile(archive, bytes);
		const { stdout } = await execute('unzip', ['-p', archive, 'environment.json']);
		const environment = JSON.parse(stdout);
		assert.ok(environment && typeof environment === 'object' && !Array.isArray(environment));
		assert.equal(environment.sha, run.head_sha, 'Test environment source differs from successful E2E');
		assert.match(environment.fingerprint, /^[a-f0-9]{64}$/, 'Invalid test environment fingerprint');
		assert.equal(
			environment.image,
			`ghcr.io/${owner.toLowerCase()}/nexus-terminal-e2e-runner:latest`,
			'Test environment image belongs to another package or tag',
		);
		const digest = environment.observedDigest;
		assert.match(digest, /^sha256:[a-f0-9]{64}$/, 'Invalid observed test environment image digest');
		return { sha: environment.sha, image: environment.image, fingerprint: environment.fingerprint, digest };
	} catch (error) {
		failure = error;
		throw error;
	} finally {
		try {
			await rm(directory, { recursive: true, force: true });
		} catch (error) {
			if (failure) throw new AggregateError([failure, error], 'Test environment inspection and cleanup failed');
			throw error;
		}
	}
}
