import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, 'functional-screenshot-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '.tmp', 'functional-screenshots'));

const actual = fs.existsSync(root)
  ? fs.readdirSync(root).filter((name) => name.endsWith('.png')).sort()
  : [];
const expected = [...manifest].sort();
const missing = expected.filter((name) => !actual.includes(name));
const unexpected = actual.filter((name) => !expected.includes(name));

if (missing.length || unexpected.length) {
  if (missing.length) console.error(`Missing functional screenshots: ${missing.join(', ')}`);
  if (unexpected.length) console.error(`Unexpected functional screenshots: ${unexpected.join(', ')}`);
  process.exit(1);
}

console.log(`Verified ${expected.length} functional screenshots in ${root}`);
