import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

/** Keep the original process and exit status under Playwright's process-group owner. */
export function captureWebServerOutput(command: string, directory: string): string {
	mkdirSync(directory, { recursive: true });
	const file = path.join(mkdtempSync(path.join(directory, 'run-')), 'output.log');
	const quotedFile = "'" + file.replaceAll("'", "'\\''") + "'";
	return `exec ${command} >> ${quotedFile} 2>&1`;
}
