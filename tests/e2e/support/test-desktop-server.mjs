import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const port = (name, fallback) => {
	const value = Number(process.env[name] ?? fallback);
	if (!Number.isInteger(value) || value < 1 || value > 65535) {
		throw new Error('Invalid fixture port');
	}
	return value;
};

const rdpPort = port('NEXUS_E2E_RDP_PORT', 23389);
const vncPort = port('NEXUS_E2E_VNC_PORT', 25900);
const controlPort = port('NEXUS_E2E_DESKTOP_CONTROL_PORT', 29090);
const directory = await mkdtemp(path.join(tmpdir(), 'nexus-e2e-desktop-'));
const env = { ...process.env };
const children = new Set();
let shuttingDown = false;

const run = (command, args, options = {}) => {
	const child = spawn(command, args, { env, stdio: ['pipe', 'ignore', 'pipe'], ...options });
	children.add(child);
	child.once('close', () => children.delete(child));
	child.once('error', () => {
		if (!shuttingDown) {
			void shutdown(1);
		}
	});
	child.stderr.resume();
	return child;
};

const waitFor = async (read, accept) => {
	const deadline = Date.now() + 25000;
	while (!shuttingDown && Date.now() < deadline) {
		try {
			if (accept(await read())) {
				return;
			}
		} catch {
			await delay(100);
		}
		await delay(100);
	}
	throw new Error('Desktop fixture did not become ready');
};

const command = (name) => (existsSync('/usr/bin/tiger' + name) ? 'tiger' + name : name);

const x = (...args) => execFileSync('xdotool', args, { env, encoding: 'utf8', timeout: 3000 }).trim();

const clipboard = () =>
	execFileSync('xclip', ['-selection', 'clipboard', '-o'], { env, encoding: 'utf8', timeout: 3000 });

const setClipboard = async (text) => {
	const child = run('xclip', ['-quiet', '-selection', 'clipboard', '-i']);
	child.stdin.end(text);
	await waitFor(clipboard, (value) => value === text);
};

const send = (res, status, value) => {
	res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
	res.end(JSON.stringify(value));
};

const control = http.createServer(async (req, res) => {
	try {
		if (req.method === 'GET' && req.url === '/health') {
			return send(res, 200, { ok: true, rdpPort, vncPort });
		}
		if (req.method === 'GET' && req.url === '/e2e/desktop/clipboard') {
			return send(res, 200, { text: clipboard() });
		}
		if (req.method === 'GET' && req.url === '/e2e/desktop/input') {
			return send(res, 200, { text: await readFile(path.join(directory, 'typed.txt'), 'utf8').catch(() => '') });
		}
		if (req.method === 'GET' && req.url === '/e2e/desktop/rdp-authentication') {
			const log = await readFile(path.join(directory, 'xrdp.log'), 'utf8');
			// xrdp logs the same success as both a DEBUG wm message and an INFO
			// log-window entry. Count only the latter so one connection adds one.
			return send(res, 200, {
				authenticatedSessions: log
					.split('\n')
					.filter((line) => /\[INFO\s*\]\s+VNC connection complete, connected ok\r?$/.test(line)).length,
			});
		}
		if (req.method === 'GET' && req.url === '/e2e/desktop/pointer') {
			return send(res, 200, { position: x('getmouselocation', '--shell') });
		}
		if (req.method === 'POST' && req.url === '/e2e/desktop/clipboard') {
			let bytes = 0;
			const chunks = [];
			for await (const chunk of req) {
				bytes += chunk.length;
				if (bytes > 2 * 1024 * 1024) {
					return send(res, 413, { code: 'limit_exceeded' });
				}
				chunks.push(chunk);
			}
			const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			if (typeof payload.text !== 'string') {
				return send(res, 400, { code: 'invalid_input' });
			}
			await setClipboard(payload.text);
			return send(res, 200, { ok: true });
		}
		send(res, 404, { code: 'not_found' });
	} catch {
		send(res, 500, { code: 'fixture_failed' });
	}
});

async function shutdown(status = 0) {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	control.close();
	const original = [...children];
	for (const child of original) {
		child.kill('SIGTERM');
	}
	await Promise.all(
		original.map(
			(child) =>
				new Promise((resolve) => {
					if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
						return resolve();
					}
					const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
					child.once('close', () => {
						clearTimeout(timer);
						resolve();
					});
				}),
		),
	);
	await rm(directory, { recursive: true, force: true });
	process.exit(status);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

control.on('error', () => void shutdown(1));

try {
	await mkdir('/run/xrdp', { recursive: true });
	const password = execFileSync(command('vncpasswd'), ['-f'], { input: 'b10-pass\n' });
	await writeFile(path.join(directory, 'passwd'), password, { mode: 0o600 });
	execFileSync(
		'openssl',
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-keyout',
			path.join(directory, 'key.pem'),
			'-out',
			path.join(directory, 'cert.pem'),
			'-days',
			'1',
			'-subj',
			'/CN=localhost',
		],
		{ stdio: 'ignore' },
	);
	const xvnc = existsSync('/usr/bin/Xtigervnc') ? 'Xtigervnc' : 'Xvnc';
	const xvncProcess = run(
		xvnc,
		[
			'-displayfd',
			'3',
			'-geometry',
			'2400x1400',
			'-depth',
			'24',
			'-rfbport',
			String(vncPort),
			'-localhost',
			'yes',
			'-AlwaysShared',
			'-SecurityTypes',
			'VncAuth',
			'-PasswordFile',
			path.join(directory, 'passwd'),
		],
		{ stdio: ['pipe', 'ignore', 'pipe', 'pipe'] },
	);
	let displayOutput = '';
	xvncProcess.stdio[3].setEncoding('utf8');
	xvncProcess.stdio[3].on('data', (chunk) => {
		displayOutput += chunk;
	});
	await waitFor(
		() => displayOutput,
		(value) => /^\d+\n$/.test(value),
	);
	env.DISPLAY = ':' + displayOutput.trim();
	await waitFor(
		() => x('getmouselocation'),
		(value) => value.length > 0,
	);
	run(command('vncconfig'), ['-nowin']);
	run('xterm', [
		'-geometry',
		'180x70+0+0',
		'-title',
		'Nexus-E2E-Desktop',
		'-e',
		'sh',
		'-c',
		'stty -echo; cat >> "$1"',
		'fixture',
		path.join(directory, 'typed.txt'),
	]);
	await waitFor(
		() => {
			// Xterm sets its title before mapping the window. X_SetInputFocus
			// rejects an unmapped window with BadMatch; wait for a viewable one.
			const windowId = x('search', '--onlyvisible', '--name', '^Nexus-E2E-Desktop$').split('\n')[0];
			x('windowfocus', windowId);
			return x('getwindowfocus') === windowId;
		},
		(value) => value,
	);
	await writeFile(
		path.join(directory, 'xrdp.ini'),
		`[Globals]\nini_version=1\nfork=true\nport=tcp://127.0.0.1:${rdpPort}\nsecurity_layer=tls\ncertificate=${directory}/cert.pem\nkey_file=${directory}/key.pem\ncrypt_level=high\nmax_bpp=32\nbitmap_cache=true\nbitmap_compression=true\nallow_channels=true\nautorun=vnc\n[Logging]\nLogFile=${directory}/xrdp.log\nLogLevel=DEBUG\nEnableSyslog=false\n[Channels]\nrdpdr=true\nrdpsnd=true\ncliprdr=true\ndrdynvc=true\n[vnc]\nname=Fixture\nlib=libvnc.so\nusername=na\npassword=askb10-pass\nip=127.0.0.1\nport=${vncPort}\n`,
	);
	run('xrdp', ['--nodaemon', '--config', path.join(directory, 'xrdp.ini')]);
	await waitFor(
		() =>
			new Promise((resolve) => {
				const socket = net.createConnection({ host: '127.0.0.1', port: rdpPort });
				socket.once('connect', () => {
					socket.destroy();
					resolve(true);
				});
				socket.once('error', () => resolve(false));
			}),
		(value) => value,
	);
	await setClipboard('Nexus E2E desktop ready');
	control.listen(controlPort, '127.0.0.1', () =>
		console.log(`[E2E desktop] RDP=${rdpPort} VNC=${vncPort} control=${controlPort}`),
	);
} catch {
	console.error('Real RDP/VNC fixture startup failed; inspect installed xrdp/TigerVNC prerequisites.');
	await shutdown(1);
}
