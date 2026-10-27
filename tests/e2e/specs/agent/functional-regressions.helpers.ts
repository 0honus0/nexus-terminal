import { createHash } from 'node:crypto';
import { readFile, readdir, readlink } from 'node:fs/promises';
import net from 'node:net';
import { expect } from '../../support/fixtures';

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export const tcpPortOpen = (port: number): Promise<boolean> =>
	new Promise((resolve) => {
		const socket = net.connect({ host: '127.0.0.1', port });

		const finish = (open: boolean) => {
			socket.destroy();
			resolve(open);
		};

		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
		socket.setTimeout(1_000, () => finish(false));
	});

export const processGone = async (pid: number) => {
	expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
	try {
		await readFile(`/proc/${pid}/cmdline`);
		return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return true;
		}
		throw error;
	}
};

export const listenerPid = async (port: number): Promise<number | null> => {
	const localAddress = `0100007F:${port.toString(16).toUpperCase().padStart(4, '0')}`;
	const tcp = await readFile('/proc/net/tcp', 'utf8');
	const inode = tcp
		.split('\n')
		.map((line) => line.trim().split(/\s+/))
		.find((fields) => fields[1] === localAddress && fields[3] === '0A')?.[9];
	if (!inode) {
		return null;
	}
	for (const entry of await readdir('/proc')) {
		if (!/^\d+$/.test(entry)) {
			continue;
		}
		let descriptors: string[];
		try {
			descriptors = await readdir(`/proc/${entry}/fd`);
		} catch {
			continue;
		}
		for (const descriptor of descriptors) {
			try {
				if ((await readlink(`/proc/${entry}/fd/${descriptor}`)) === `socket:[${inode}]`) {
					return Number(entry);
				}
			} catch {
				/* A process may close a descriptor during this read. */
			}
		}
	}
	return null;
};
