import { writeFile } from 'node:fs/promises';

// Pin reviewed upstream data instead of making registration depend on a remote directory.
const revision = process.argv[2];
if (!revision || !/^[a-f0-9]{40}$/u.test(revision)) {
	throw new Error('Usage: node scripts/maintenance/update-passkey-authenticators.mjs <Pocket ID commit SHA>');
}
const source = `https://raw.githubusercontent.com/pocket-id/pocket-id/${revision}`;
const [dataResponse, licenseResponse] = await Promise.all([
	fetch(`${source}/backend/resources/aaguids.json`),
	fetch(`${source}/LICENSE`),
]);
if (!dataResponse.ok || !licenseResponse.ok) {
	throw new Error('Cannot read the reviewed Pocket ID metadata and license');
}
const data = await dataResponse.json();
const license = await licenseResponse.text();
if (!data || typeof data !== 'object' || Array.isArray(data) || !license.includes('Redistribution and use')) {
	throw new Error('Invalid Pocket ID metadata or license');
}
const entries = Object.entries(data).map(([id, entry]) => {
	if (
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(id) ||
		!entry ||
		typeof entry !== 'object' ||
		Array.isArray(entry) ||
		typeof entry.name !== 'string' ||
		!entry.name.trim() ||
		/[\u0000-\u001f\u007f]/u.test(entry.name)
	) {
		throw new Error(`Invalid authenticator metadata for ${id}`);
	}
	return [id, entry.name];
});
if (!entries.length) {
	throw new Error('Refusing to replace the authenticator directory with an empty upstream snapshot');
}
entries.sort(([left], [right]) => left.localeCompare(right));
const header = [
	'Generated name-only snapshot; update with scripts/maintenance/update-passkey-authenticators.mjs.',
	`Source: ${source}/backend/resources/aaguids.json`,
	'Display hints only; never use for authenticator trust. No runtime network or icons.',
	'',
	license.trim(),
]
	.join('\n')
	.replaceAll('*/', '* /');
await writeFile(
	new URL('../../packages/backend/src/platform/security/adapters/passkey-authenticators.ts', import.meta.url),
	`/*\n${header}\n*/\n\nexport const passkeyAuthenticatorNames: ReadonlyMap<string, string> = new Map(${JSON.stringify(entries, null, '\t')});\n`,
);
process.stdout.write(`Updated ${entries.length} authenticator display names from Pocket ID ${revision}\n`);
