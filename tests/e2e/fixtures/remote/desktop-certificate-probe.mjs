import assert from 'node:assert/strict';
import tls from 'node:tls';
import crypto from 'node:crypto';
import net from 'node:net';
import { writeSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

// Test-only native-call checkpoints keep a probe crash in this child process.
const trace = (stage) => writeSync(2, 'RDP TLS checkpoint: ' + stage + '\n');

for (const name of ['getPeerCertificate', 'getPeerX509Certificate']) {
	const original = tls.TLSSocket.prototype[name];
	tls.TLSSocket.prototype[name] = function (...args) {
		trace(name + ' begin');
		const result = original.apply(this, args);
		trace(name + ' end');
		return result;
	};
}
const OriginalCertificate = crypto.X509Certificate;
crypto.X509Certificate = class extends OriginalCertificate {
	constructor(...args) {
		trace('X509 constructor begin');
		super(...args);
		trace('X509 constructor end');
	}
};
for (const name of ['validFromDate', 'validToDate', 'fingerprint256', 'subject', 'issuer']) {
	const descriptor = Object.getOwnPropertyDescriptor(OriginalCertificate.prototype, name);
	Object.defineProperty(OriginalCertificate.prototype, name, {
		...descriptor,

		get() {
			trace(name + ' begin');
			const value = descriptor.get.call(this);
			trace(name + ' end');
			return value;
		},
	});
}
const originalDestroy = net.Socket.prototype.destroy;
net.Socket.prototype.destroy = function (...args) {
	const relevant = this instanceof tls.TLSSocket || this.remotePort === Number(process.argv[2]);
	if (relevant) trace(this instanceof tls.TLSSocket ? 'TLS destroy begin' : 'TCP destroy begin');
	const result = originalDestroy.apply(this, args);
	if (relevant) trace(this instanceof tls.TLSSocket ? 'TLS destroy end' : 'TCP destroy end');
	return result;
};
syncBuiltinESMExports();
const { probeRdpCertificate } = await import('../../../../packages/backend/dist/platform/desktop/adapters/rdp-tls.js');
trace('probe begin');
const certificate = await probeRdpCertificate('127.0.0.1', Number(process.argv[2]), AbortSignal.timeout(10_000));
assert.match(certificate.fingerprint, /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
assert.equal(certificate.systemTrusted, false);
assert.equal(certificate.hostMatches, false);
trace('probe closed');
console.log('PASS real RDP certificate probe and socket cleanup');
