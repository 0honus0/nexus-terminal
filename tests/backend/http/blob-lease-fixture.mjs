import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { until } from '../remote/openssh-fixture.mjs';

// Linux leases block the real NativeBlobStore open without replacing its implementation.
// SIGIO proves a conflicting open reached the kernel before authority is changed.
const holder = String.raw`
use strict;
use warnings;
use Fcntl qw(O_RDWR F_SETLEASE F_WRLCK F_UNLCK);
$| = 1;
sysopen(my $file, $ARGV[0], O_RDWR) or die "open: $!";
$SIG{IO} = sub { print "blocked\n"; };
fcntl($file, F_SETLEASE, F_WRLCK) or die "lease: $!";
print "ready\n";
my $buffer;
while (1) {
 my $size = sysread(STDIN, $buffer, 1);
 if (!defined $size) { next if $!{EINTR}; die "stdin: $!"; }
 last if $size == 0 || $buffer eq 'r';
}
fcntl($file, F_SETLEASE, F_UNLCK) or die "unlock: $!";
close($file) or die "close: $!";
`;

export async function holdBlobOpen(t, f, artifact) {
	assert.equal(process.platform, 'linux');
	const child = spawn('perl', ['-e', holder, join(dirname(f.database), 'artifacts', artifact.id + '.blob')]);
	const messages = [];
	let stderr = '';
	let failed;
	child.stdin.on('error', (error) => (failed = error));
	child.stderr.on('data', (value) => (stderr += value));
	const lines = createInterface({ input: child.stdout });
	lines.on('line', (line) => messages.push(line));
	const closed = new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('close', (code, signal) => {
			lines.close();
			if (code === 0 && !failed) resolve();
			else if (code === 0) reject(failed);
			else reject(new Error('Blob lease holder failed: ' + JSON.stringify({ code, signal, stderr })));
		});
	});
	void closed.catch((error) => (failed = error));
	let release;

	const unlock = () => {
		release ??= Promise.resolve().then(async () => {
			if (!child.stdin.destroyed) child.stdin.end('r');
			await closed;
		});
		return release;
	};

	t.after(unlock);

	async function wait(message) {
		await until(
			() => {
				if (failed) throw failed;
				return messages.includes(message);
			},
			Boolean,
			'actual kernel blob lease: ' + message,
		);
	}

	await wait('ready');
	return {
		blocked: () => wait('blocked'),

		release: unlock,
	};
}
