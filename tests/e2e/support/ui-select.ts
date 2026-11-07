import { expect, type Locator } from '@playwright/test';

export async function selectUiOption(trigger: Locator, value: string): Promise<void> {
	// Reka portals the options within the control's document and hides the
	// original trigger from the accessibility tree while its popup is open.
	const control = await trigger.elementHandle();
	if (!control) throw new Error('Select control is unavailable');
	const frame = await control.ownerFrame();
	await control.dispose();
	if (!frame) throw new Error('Select document is unavailable');
	await trigger.click();
	await frame.locator(`[role="option"][data-value=${JSON.stringify(value)}]`).click();
}

export async function expectUiSelectValue(trigger: Locator, value: string): Promise<void> {
	await expect(trigger).toHaveAttribute('data-value', value);
}
