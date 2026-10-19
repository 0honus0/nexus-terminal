export const OFFICIAL_PLUGIN_SOURCE = Object.freeze({
	catalogUrl: 'https://github.com/0honus0/nexus-agent-plugins/releases/latest/download/catalog.json',
	publisherKeyId: 'ed25519:617ec64b03cd6ed1a1ddf373e3a47f38666cdcd27753d674e136a4d0a359a1a0',
	publisherPublicKeyPem:
		'-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAPw+WXiJPcxqiKjxGCRcm3fWwy+JByAKTKX+iE5pKD/E=\n-----END PUBLIC KEY-----\n',
	publisherLabel: 'Nexus first-party plugins',
	recommendedAppId: 'nexus.agent',
});

/** Compare the bounded, validated version grammar used by the current package format. */
export function comparePluginVersions(left: string, right: string): number {
	const a = left.split('-'),
		b = right.split('-');
	const coreA = a[0].split('.').map(BigInt),
		coreB = b[0].split('.').map(BigInt);
	for (let index = 0; index < 3; index++) {
		if (coreA[index] !== coreB[index]) {
			return coreA[index] > coreB[index] ? 1 : -1;
		}
	}
	const preA = a.slice(1).join('-'),
		preB = b.slice(1).join('-');
	if (!preA || !preB) {
		return preA === preB ? 0 : preA ? -1 : 1;
	}
	const partsA = preA.split('.'),
		partsB = preB.split('.');
	for (let index = 0; index < Math.max(partsA.length, partsB.length); index++) {
		const first = partsA[index],
			second = partsB[index];
		if (first === undefined || second === undefined) {
			return first === second ? 0 : first === undefined ? -1 : 1;
		}
		if (first === second) {
			continue;
		}
		const numericA = /^[0-9]+$/u.test(first),
			numericB = /^[0-9]+$/u.test(second);
		if (numericA && numericB) {
			return BigInt(first) > BigInt(second) ? 1 : -1;
		}
		if (numericA !== numericB) {
			return numericA ? -1 : 1;
		}
		return first > second ? 1 : -1;
	}
	return 0;
}
