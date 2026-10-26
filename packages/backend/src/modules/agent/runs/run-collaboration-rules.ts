import type { Participant, ChildAdmissionFacts, DelegateCommand } from './model/run-collaboration-types.js';

export const COLLABORATION_MAX_FACTS = 128;

export function mayDelegate(command: DelegateCommand, facts: ChildAdmissionFacts): boolean {
	return (
		facts.parent.parentId === null &&
		facts.parent.status === 'running' &&
		command.deadline > facts.now &&
		command.deadline <= facts.parent.deadline &&
		command.targets.every((id) => facts.selectedTargets.includes(id)) &&
		facts.dependencies.length === command.dependencies.length &&
		facts.dependencies.every(
			(child) =>
				child.parentId === facts.parent.id &&
				(command.dependencyMode !== 'success' || !['failed', 'unknown', 'cancelled'].includes(child.status)),
		)
	);
}

export function isSettled(status: Participant['status']): boolean {
	return status !== 'pending' && status !== 'running';
}
