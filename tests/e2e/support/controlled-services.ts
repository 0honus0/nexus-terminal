import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { E2E_URLS } from '../../support/protocols/test-environment';

const definitions = {
	ssh: { entry: 'controlled-ssh-server.mjs', health: E2E_URLS.sshControlOrigin + '/health' },
	desktop: { entry: 'desktop-server.mjs', health: E2E_URLS.desktopControlOrigin + '/health' },
};

export type E2EServiceName = keyof typeof definitions;

type Exit = { code: number | null; signal: NodeJS.Signals | null; failure: Error | null };

type Service = {
	name: E2EServiceName;
	child: ChildProcess;
	log: WriteStream;
	exit: Promise<Exit>;
	failures: Error[];
	startedAt: number;
	readyMs: number | null;
	drainMs: number | null;
};

async function within<T>(work: Promise<T>, milliseconds: number, description: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(description)), milliseconds);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** Playwright owns the worker; this fixture owns only its explicitly requested protocol peers. */
export class ControlledServices {
	private readonly services = new Map<E2EServiceName, Service>();
	private readonly starting = new Map<E2EServiceName, Promise<void>>();
	private closing: Promise<void> | null = null;

	constructor(private readonly directory: string) {}

	async ensure(names: readonly E2EServiceName[]): Promise<void> {
		if (this.closing) throw new Error('Controlled services are closing');
		const results = await Promise.allSettled(
			names.map((name) => {
				let starting = this.starting.get(name);
				if (!starting) {
					starting = this.start(name);
					this.starting.set(name, starting);
				}
				return starting;
			}),
		);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		for (const name of names) {
			const service = this.services.get(name);
			if (service && (service.child.exitCode !== null || service.child.signalCode !== null))
				failures.push(new Error(name + ' exited before its test; inspect ' + this.directory));
		}
		if (failures.length) throw new AggregateError(failures, 'Controlled service startup failed');
	}

	close(): Promise<void> {
		this.closing ??= Promise.resolve().then(async () => {
			const starts = await Promise.allSettled(this.starting.values());
			const outcomes = await Promise.allSettled([...this.services.values()].map((service) => this.stop(service)));
			const failures = [...starts, ...outcomes].flatMap((result) =>
				result.status === 'rejected' ? [result.reason] : [],
			);
			await mkdir(this.directory, { recursive: true });
			await writeFile(
				path.join(this.directory, 'timings.json'),
				JSON.stringify(
					[...this.services.values()].map((service) => ({
						name: service.name,
						runtimeRoot: service.name === 'ssh' ? process.env.NEXUS_E2E_SERVICE_ROOT : undefined,
						pid: service.child.pid,
						readyMs: service.readyMs,
						drainMs: service.drainMs,
						exitCode: service.child.exitCode,
						signal: service.child.signalCode,
					})),
					null,
					2,
				),
			);
			if (failures.length) throw new AggregateError(failures, 'Controlled services did not drain');
		});
		return this.closing;
	}

	private async start(name: E2EServiceName): Promise<void> {
		await mkdir(this.directory, { recursive: true });
		const definition = definitions[name];
		const env = { ...process.env };
		const log = createWriteStream(path.join(this.directory, name + '.log'));
		const failures: Error[] = [];
		log.on('error', (error) => failures.push(error));
		const startedAt = performance.now();
		const child = spawn(
			process.execPath,
			[path.resolve(import.meta.dirname, '../../support/protocols', definition.entry)],
			{
				env,
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		child.stdout?.pipe(log, { end: false });
		child.stderr?.pipe(log, { end: false });
		let failure: Error | null = null;
		const exit = new Promise<Exit>((resolve) => {
			child.once('error', (error) => {
				failure = error;
			});
			child.once('close', (code, signal) => resolve({ code, signal, failure }));
		});
		const service: Service = { name, child, log, exit, failures, startedAt, readyMs: null, drainMs: null };
		this.services.set(name, service);
		const deadline = startedAt + 30_000; // Same readiness budget as the previous Playwright webServer.
		let lastFailure: unknown;
		while (performance.now() < deadline) {
			if (failure) throw failure;
			if (child.exitCode !== null || child.signalCode !== null)
				throw new Error(name + ' exited during startup; inspect ' + this.directory);
			try {
				const response = await fetch(definition.health, { signal: AbortSignal.timeout(1000) });
				await response.arrayBuffer();
				if (!response.ok) throw new Error(name + ' readiness HTTP ' + response.status);
				service.readyMs = performance.now() - startedAt;
				return;
			} catch (error) {
				lastFailure = error;
			}
			await delay(20);
		}
		throw new Error(name + ' readiness failed; inspect ' + this.directory, { cause: lastFailure });
	}

	private async stop(service: Service): Promise<void> {
		const startedAt = performance.now();
		const failures: unknown[] = [...service.failures];
		if (service.child.exitCode !== null || service.child.signalCode !== null)
			failures.push(new Error(service.name + ' exited before fixture teardown'));
		else service.child.kill('SIGTERM');
		try {
			await within(service.exit, 10_000, service.name + ' did not stop after SIGTERM');
		} catch (error) {
			failures.push(error);
			// A forced stop is retained as a failed teardown, never a successful drain.
			service.child.kill('SIGKILL');
		}
		const result = await service.exit;
		if (result.failure) failures.push(result.failure);
		if (result.code !== 0)
			failures.push(new Error(service.name + ' exited abnormally: ' + result.code + '/' + result.signal));
		service.log.end();
		try {
			await finished(service.log);
		} catch (error) {
			failures.push(error);
		}
		service.drainMs = performance.now() - startedAt;
		if (failures.length) throw new AggregateError(failures, service.name + ' cleanup failed');
	}
}
