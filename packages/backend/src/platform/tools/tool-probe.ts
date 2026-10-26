import type { InstallableTool } from './tool-port.js';

/** Exact capabilities required by the native archive commands. Tool names are a closed technical union. */
export function toolProbe(tool: InstallableTool): string {
	const executable = "'" + tool + "'";
	const available = 'command -v ' + executable + ' >/dev/null 2>&1';
	if (tool === 'tar' || tool === 'cp' || tool === 'ln') {
		return available + ' && case "$(' + executable + ' --version 2>/dev/null)" in *GNU*) true ;; *) false ;; esac';
	}
	return available;
}
