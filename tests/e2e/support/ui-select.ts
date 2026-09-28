import { expect, type Locator } from '@playwright/test';

export async function selectUiOption(trigger: Locator, value: string): Promise<void> {
  await trigger.click();
  await trigger
    .page()
    .locator(`[role="option"][data-value=${JSON.stringify(value)}]`)
    .click();
}

export async function expectUiSelectValue(trigger: Locator, value: string): Promise<void> {
  await expect(trigger).toHaveAttribute('data-value', value);
}
