import { compare } from 'semver';

export const OFFICIAL_PLUGIN_SOURCE = Object.freeze({
	catalogUrl: 'https://github.com/0honus0/nexus-agent-plugins/releases/latest/download/catalog.json',
	publisherKeyId: 'ed25519:617ec64b03cd6ed1a1ddf373e3a47f38666cdcd27753d674e136a4d0a359a1a0',
	publisherPublicKeyPem:
		'-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAPw+WXiJPcxqiKjxGCRcm3fWwy+JByAKTKX+iE5pKD/E=\n-----END PUBLIC KEY-----\n',
	publisherLabel: 'Nexus first-party plugins',
	recommendedAppId: 'nexus.agent',
});

/** Versions are admitted by the shared SemVer contract before comparison. */
export function comparePluginVersions(left: string, right: string): number {
	return compare(left, right);
}
