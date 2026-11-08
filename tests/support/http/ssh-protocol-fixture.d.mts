import { test as baseTest } from 'vitest';
import type { ControlledSsh } from '../protocols/controlled-ssh-fixture.mjs';
import type { HttpProtocolFixtures } from './protocol-fixture.mjs';

export { expect, loginAsAdmin, HTTP_TEST_ORIGIN } from './protocol-fixture.mjs';

export const test: ReturnType<typeof baseTest.extend<HttpProtocolFixtures & { ssh: ControlledSsh }>>;
