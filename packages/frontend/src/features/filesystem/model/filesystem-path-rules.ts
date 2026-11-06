export function parentOf(path: string): string {
	const normalized = path.replace(/\/+$/, '') || '/';
	const index = normalized.lastIndexOf('/');
	return index <= 0 ? '/' : normalized.slice(0, index);
}
