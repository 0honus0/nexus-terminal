import { test, expect } from 'vitest';
import { createPinia } from 'pinia';
import { useDialogStore } from '../../../../packages/frontend/src/shared/feedback/store/dialog.store.ts';

test('cancelling the replaced confirmation cannot close or settle the current owner', async () => {
	const dialogs = useDialogStore(createPinia());
	const oldOwner = new AbortController();
	const oldConfirm = dialogs.confirm({ message: 'old owner', signal: oldOwner.signal });
	const currentConfirm = dialogs.confirm({ message: 'current owner' });
	try {
		oldOwner.abort();
		expect(await oldConfirm).toBe(false);
		expect(dialogs.state.visible).toBe(true);
		expect(dialogs.state.message).toBe('current owner');
		dialogs.accept();
		expect(await currentConfirm).toBe(true);
	} finally {
		dialogs.cancel();
	}
});
