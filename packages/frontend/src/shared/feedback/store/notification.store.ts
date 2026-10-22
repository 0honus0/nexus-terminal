import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { NotificationKind, UiNotification, UiNotificationAction } from '../model';

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_ERROR_TIMEOUT_MS = 0;
const ERROR_DEDUPE_MS = 15_000;

export const useNotificationStore = defineStore('shared-notifications', () => {
	const notifications = ref<UiNotification[]>([]);
	const recentErrors = new Map<string, number>();
	let nextId = 1;

	const remove = (id: number): void => {
		notifications.value = notifications.value.filter((notification) => notification.id !== id);
	};

	const show = (
		kind: NotificationKind,
		message: string,
		timeoutMs = kind === 'error' ? DEFAULT_ERROR_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
		action?: UiNotificationAction,
	): number | null => {
		const existing = notifications.value.find(
			(notification) =>
				notification.kind === kind &&
				notification.message === message &&
				(!notification.action || !action || notification.action.key === action.key),
		);
		if (existing) {
			if (action) existing.action = action;
			return existing.id;
		}
		if (kind === 'error') {
			const now = Date.now();
			const dedupeKey = JSON.stringify([message, action?.key ?? null]);
			const previous = recentErrors.get(dedupeKey);
			if (previous !== undefined && now - previous < ERROR_DEDUPE_MS) return null;
			recentErrors.set(dedupeKey, now);
			for (const [key, shownAt] of recentErrors) {
				if (now - shownAt >= ERROR_DEDUPE_MS) recentErrors.delete(key);
			}
		}

		const id = nextId++;
		notifications.value.push({ id, kind, message, timeoutMs, action });
		if (timeoutMs > 0) window.setTimeout(() => remove(id), timeoutMs);
		return id;
	};

	return {
		notifications,
		remove,
		show,

		success: (message: string, timeoutMs?: number) => show('success', message, timeoutMs),

		error: (message: string, timeoutMs?: number, action?: UiNotificationAction) =>
			show('error', message, timeoutMs, action),

		info: (message: string, timeoutMs?: number) => show('info', message, timeoutMs),

		warning: (message: string, timeoutMs?: number) => show('warning', message, timeoutMs),
	};
});
