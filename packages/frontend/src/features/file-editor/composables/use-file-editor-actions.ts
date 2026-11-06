import { onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { useAuthenticatedViewScope } from '@/shared/session/public';
import type {
	FileEditorCloseActions,
	FileEditorCloseRegistration,
	FileEditorSessionController,
} from '../model/file-editor-session-types';

export function useFileEditorActions(options: {
	session: () => FileEditorSessionController;
	active: () => boolean;
	confirmDiscard: (signal: AbortSignal) => Promise<boolean>;
}): FileEditorCloseActions & {
	reload(): Promise<void>;
	changeEncoding(value: unknown): Promise<void>;
} {
	const activated = ref(true);
	let revision = Symbol('document-revision');
	let pendingConfirmation: AbortController | undefined;
	let closeRegistration: FileEditorCloseRegistration | undefined;

	const cancelConfirmation = (): void => {
		pendingConfirmation?.abort();
		pendingConfirmation = undefined;
	};

	const view = useAuthenticatedViewScope({
		available: () => activated.value && options.active(),

		onRevoke: cancelConfirmation,
	});

	watch(
		() => {
			const session = options.session();
			const doc = session.active.value;
			return [session, doc, doc?.content, doc?.originalContent, doc?.encoding, doc?.dirty, doc?.saveState];
		},
		() => {
			revision = Symbol('document-revision');
			cancelConfirmation();
		},
		{ flush: 'sync' },
	);

	const confirmDiscard = async (): Promise<boolean> => {
		const permission = view.capture();
		if (!view.isCurrent(permission)) return false;
		const session = options.session();
		cancelConfirmation();
		const confirmation = new AbortController();
		pendingConfirmation = confirmation;
		try {
			const confirmed = await options.confirmDiscard(AbortSignal.any([permission, confirmation.signal]));
			return (
				confirmed &&
				pendingConfirmation === confirmation &&
				!confirmation.signal.aborted &&
				view.isCurrent(permission) &&
				options.session() === session
			);
		} finally {
			if (pendingConfirmation === confirmation) pendingConfirmation = undefined;
		}
	};

	watch(
		() => ({ session: options.session(), available: activated.value && options.active() }),
		({ session, available }) => {
			closeRegistration?.dispose();
			closeRegistration = undefined;
			cancelConfirmation();
			if (available) closeRegistration = session.setCloseConfirmation(confirmDiscard);
		},
		{ immediate: true, flush: 'sync' },
	);

	const closeDocumentGroup = (
		action: (registration: FileEditorCloseRegistration) => Promise<boolean>,
	): Promise<boolean> => {
		if (!view.isCurrent(view.capture()) || !closeRegistration) return Promise.resolve(false);
		return action(closeRegistration);
	};

	const loadActiveDocument = async (encoding?: string): Promise<void> => {
		const session = options.session();
		const doc = session.active.value;
		const permission = view.capture();
		if (!doc || doc.saveState === 'saving' || !view.isCurrent(permission)) return;
		const originalRevision = revision;
		if (doc.dirty && !(await confirmDiscard())) return;
		if (
			!view.isCurrent(permission) ||
			options.session() !== session ||
			session.active.value !== doc ||
			revision !== originalRevision ||
			session.active.value?.saveState === 'saving'
		)
			return;
		try {
			if (encoding) await session.changeEncoding(doc.id, encoding);
			else await session.reload(doc.id);
		} catch {
			// The session retains the current read failure on its original document.
		}
	};

	onActivated(() => {
		activated.value = true;
	});
	onDeactivated(() => {
		activated.value = false;
	});
	onBeforeUnmount(() => {
		closeRegistration?.dispose();
		cancelConfirmation();
	});

	return {
		close: (id) => closeDocumentGroup((registration) => registration.close(id)),

		closeOthers: (id) => closeDocumentGroup((registration) => registration.closeOthers(id)),

		closeToRight: (id) => closeDocumentGroup((registration) => registration.closeToRight(id)),

		closeToLeft: (id) => closeDocumentGroup((registration) => registration.closeToLeft(id)),

		closeAll: () => closeDocumentGroup((registration) => registration.closeAll()),

		reload: () => loadActiveDocument(),

		changeEncoding: async (value: unknown): Promise<void> => {
			const doc = options.session().active.value;
			if (typeof value !== 'string' || !value || !doc || value === doc.encoding) return;
			await loadActiveDocument(value);
		},
	};
}
