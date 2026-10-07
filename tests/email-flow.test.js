import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePlantId, PLANT_IDS, PLANT_NAMES } from '../api/_lib/plants.js';
import { createSignedActionUrl, verifySignedActionUrl } from '../api/_lib/actions.js';
import { getSenderAddress, sendTransactionalEmail } from '../api/_lib/email.js';

test('normalizePlantId maps all known aliases to stable plant IDs', () => {
  assert.equal(normalizePlantId('LT'), PLANT_IDS.LT);
  assert.equal(normalizePlantId('Lanka Tiles'), PLANT_IDS.LT);
  assert.equal(normalizePlantId('lanka wall tiles'), PLANT_IDS.LWT);
  assert.equal(normalizePlantId('RCL-H'), PLANT_IDS.RCLH);
  assert.equal(normalizePlantId('Rocell Eheliyagoda'), PLANT_IDS.RCLE);
  assert.equal(normalizePlantId('rcle'), PLANT_IDS.RCLE);
  assert.equal(normalizePlantId('LWT'), PLANT_IDS.LWT);
});

test('normalizePlantId rejects unknown plants without falling back to LT', () => {
  assert.throws(() => normalizePlantId('Unknown Plant'), /Unknown plant/i);
  assert.throws(() => normalizePlantId(''), /Plant/i);
});

test('signed action URLs validate and expire correctly', () => {
  const secret = 'test-secret';
  const url = createSignedActionUrl('ORD-42', 'approve', 'https://example.com', secret, 7 * 24 * 60 * 60 * 1000);

  const parsed = verifySignedActionUrl(url, secret);
  assert.equal(parsed.orderId, 'ORD-42');
  assert.equal(parsed.action, 'approve');

  const expiredUrl = createSignedActionUrl('ORD-99', 'reject', 'https://example.com', secret, -1000);
  assert.throws(() => verifySignedActionUrl(expiredUrl, secret), /expired|Expired/i);
});

test('dry-run mode logs the target recipient and preserves a sparevone sender', async () => {
  const previous = process.env.EMAIL_DRY_RUN;
  const previousSender = process.env.SMTP_FROM;
  process.env.EMAIL_DRY_RUN = 'true';
  process.env.SMTP_FROM = 'SpareShare Enterprise Portal <sparevone@gmail.com>';

  try {
    const sender = getSenderAddress();
    assert.equal(sender, 'SpareShare Enterprise Portal <sparevone@gmail.com>');

    const result = await sendTransactionalEmail({
      to: 'lt.manager@example.com',
      subject: 'Dry-run test',
      text: 'Hello',
      html: '<p>Hello</p>'
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.from, 'SpareShare Enterprise Portal <sparevone@gmail.com>');
  } finally {
    if (previous === undefined) delete process.env.EMAIL_DRY_RUN; else process.env.EMAIL_DRY_RUN = previous;
    if (previousSender === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = previousSender;
  }
});

test('plant labels are stable and known', () => {
  assert.equal(PLANT_NAMES[PLANT_IDS.LT], 'Lanka Tiles');
  assert.equal(PLANT_NAMES[PLANT_IDS.LWT], 'Lanka Wall Tiles');
  assert.equal(PLANT_NAMES[PLANT_IDS.RCLH], 'Rocell Horana');
  assert.equal(PLANT_NAMES[PLANT_IDS.RCLE], 'Rocell Eheliyagoda');
});
