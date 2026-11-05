import { usePresentationStore, type PersonalLayout } from '@/features/preferences/public';
import type { WorkspaceLayoutNodeState } from '../model/presentation-types';
import type { WorkspaceSettingsRepository } from '../ports/workspace-settings-repository';

function toPersonalLayout(node: WorkspaceLayoutNodeState): PersonalLayout {
	if (node.size === undefined) throw new Error('Incomplete layout size');
	if (node.type === 'pane') {
		if (!node.component) throw new Error('Incomplete layout pane');
		return { id: node.id, type: 'pane', size: node.size, component: node.component };
	}
	if (!node.direction || !node.children) throw new Error('Incomplete layout container');
	return {
		id: node.id,
		type: 'container',
		size: node.size,
		direction: node.direction,
		children: node.children.map(toPersonalLayout),
	};
}

function fromPersonalLayout(node: PersonalLayout): WorkspaceLayoutNodeState {
	if (node.type === 'pane') return { id: node.id, type: 'pane', size: node.size, component: node.component };
	return {
		id: node.id,
		type: 'container',
		size: node.size,
		direction: node.direction,
		children: node.children.map(fromPersonalLayout),
	};
}

export const workspaceSettingsAdapter: WorkspaceSettingsRepository = {
	async loadLayout(recover = false) {
		const value = await usePresentationStore().load(recover);
		return {
			layout: fromPersonalLayout(value.layout),
			sidebar: { left: value.sidebar.left.map((pane) => pane), right: value.sidebar.right.map((pane) => pane) },
		};
	},

	async saveResizedLayout(layout, baseline, permission) {
		await usePresentationStore().saveLayoutSizes(toPersonalLayout(layout), toPersonalLayout(baseline), permission);
	},

	async saveLayout(configuration, baseline, permission) {
		const value = await usePresentationStore().saveWorkspaceLayout(
			{
				layout: toPersonalLayout(configuration.layout),
				sidebar: {
					left: configuration.sidebar.left.map((pane) => pane),
					right: configuration.sidebar.right.map((pane) => pane),
				},
			},
			{
				layout: toPersonalLayout(baseline.layout),
				sidebar: {
					left: baseline.sidebar.left.map((pane) => pane),
					right: baseline.sidebar.right.map((pane) => pane),
				},
			},
			permission,
		);
		return {
			layout: fromPersonalLayout(value.layout),
			sidebar: { left: value.sidebar.left.map((pane) => pane), right: value.sidebar.right.map((pane) => pane) },
		};
	},

	async loadFocus(recover = false) {
		const value = await usePresentationStore().load(recover);
		return {
			version: value.version,
			focus: {
				sequence: value.focus.sequence.map((id) => id),
				shortcuts: Object.fromEntries(Object.entries(value.focus.shortcuts)),
			},
		};
	},

	async saveFocus(snapshot, permission) {
		const value = await usePresentationStore().update(
			{
				action: 'focus',
				expectedVersion: snapshot.version,
				focus: {
					sequence: snapshot.focus.sequence.map((id) => id),
					shortcuts: Object.fromEntries(Object.entries(snapshot.focus.shortcuts)),
				},
			},
			permission,
		);
		return value.version;
	},
};
