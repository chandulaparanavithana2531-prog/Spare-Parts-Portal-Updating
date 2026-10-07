import test from 'node:test';
import assert from 'node:assert/strict';

import { canResetExistingAdminPassword } from '../api/_lib/adminBootstrap.js';

test('admin recovery is available once for an existing admin account', () => {
  assert.equal(canResetExistingAdminPassword({ role: 'admin' }, 'admin'), true);
  assert.equal(canResetExistingAdminPassword({ role: 'admin' }, ' ADMIN '), true);
});

test('admin recovery cannot reset another account or be reused', () => {
  assert.equal(canResetExistingAdminPassword({ role: 'user' }, 'admin'), false);
  assert.equal(canResetExistingAdminPassword({ role: 'admin' }, 'user'), false);
  assert.equal(canResetExistingAdminPassword({ role: 'admin', adminPasswordResetUsed: true }, 'admin'), false);
  assert.equal(canResetExistingAdminPassword(null, 'admin'), false);
});