import { FileRangeNotSatisfiable, type FileReadSelection } from '../model/file-types.js';

/** Application range policy binds a decoded selection to current file size. */
export function selectDownloadRange(selection: FileReadSelection, size: number): { start: number; end: number } | null {
	if (selection.kind === 'all') {
		return null;
	}
	if (selection.kind === 'invalid' || size < 1) {
		throw new FileRangeNotSatisfiable(size);
	}
	if (selection.kind === 'suffix') {
		if (!Number.isSafeInteger(selection.length) || selection.length < 1) {
			throw new FileRangeNotSatisfiable(size);
		}
		return { start: Math.max(0, size - selection.length), end: size - 1 };
	}
	const end = selection.end ?? size - 1;
	if (
		!Number.isSafeInteger(selection.start) ||
		selection.start < 0 ||
		selection.start >= size ||
		!Number.isSafeInteger(end) ||
		end < selection.start
	) {
		throw new FileRangeNotSatisfiable(size);
	}
	return { start: selection.start, end: Math.min(size - 1, end) };
}
