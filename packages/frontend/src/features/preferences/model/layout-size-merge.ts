import type { PersonalLayout } from './preferences-types';

function sameChildSizes(left: PersonalLayout[], right: PersonalLayout[]): boolean {
	return left.length === right.length && left.every((child, index) => child.size === right[index]?.size);
}

/** Sibling proportions are one edit: merging individual sizes could invalidate their total. */
export function mergeLayoutSizes(
	baseline: PersonalLayout,
	intended: PersonalLayout,
	current: PersonalLayout,
): PersonalLayout | null {
	if (baseline.id !== intended.id || baseline.id !== current.id) {
		return null;
	}
	if (intended.size !== baseline.size && current.size !== baseline.size && current.size !== intended.size) {
		return null;
	}
	const size = intended.size === baseline.size ? current.size : intended.size;
	if (baseline.type === 'pane' && intended.type === 'pane' && current.type === 'pane') {
		if (baseline.component !== intended.component || baseline.component !== current.component) {
			return null;
		}
		return { id: current.id, type: 'pane', size, component: current.component };
	}
	if (baseline.type !== 'container' || intended.type !== 'container' || current.type !== 'container') {
		return null;
	}
	if (
		baseline.direction !== intended.direction ||
		baseline.direction !== current.direction ||
		baseline.children.length !== intended.children.length ||
		baseline.children.length !== current.children.length
	) {
		return null;
	}
	if (
		!sameChildSizes(baseline.children, intended.children) &&
		!sameChildSizes(baseline.children, current.children) &&
		!sameChildSizes(intended.children, current.children)
	) {
		return null;
	}
	const children: PersonalLayout[] = [];
	for (const [index, child] of baseline.children.entries()) {
		const intendedChild = intended.children[index];
		const currentChild = current.children[index];
		if (!intendedChild || !currentChild) {
			return null;
		}
		const merged = mergeLayoutSizes(child, intendedChild, currentChild);
		if (!merged) {
			return null;
		}
		children.push(merged);
	}
	return { id: current.id, type: 'container', size, direction: current.direction, children };
}
