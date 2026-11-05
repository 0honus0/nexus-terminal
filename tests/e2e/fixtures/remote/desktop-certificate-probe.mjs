import assert from 'node:assert/strict';
import { probeRdpCertificate } from '../../../../packages/backend/dist/platform/desktop/adapters/rdp-tls.js';
import { DesktopTransportFailure } from '../../../../packages/backend/dist/platform/desktop/desktop-port.js';

// Keep a native regression isolated: the parent verifies normal child termination and this receipt.
const port = Number(process.argv[2]);
const cancellation = new AbortController();
cancellation.abort();
await assert.rejects(
	probeRdpCertificate('127.0.0.1', port, cancellation.signal),
	(error) => error instanceof DesktopTransportFailure && error.reason === 'unavailable',
);
let fingerprint = null;
for (let attempt = 0; attempt < 3; attempt++) {
	const certificate = await probeRdpCertificate('127.0.0.1', port, AbortSignal.timeout(10_000));
	assert.match(certificate.fingerprint, /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
	assert.equal(certificate.systemTrusted, false);
	assert.equal(certificate.hostMatches, false);
	if (fingerprint !== null) assert.equal(certificate.fingerprint, fingerprint);
	fingerprint = certificate.fingerprint;
}
console.log('PASS real RDP certificate probe and socket cleanup');
