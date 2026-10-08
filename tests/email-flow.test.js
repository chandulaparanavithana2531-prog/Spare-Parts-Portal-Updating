import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePlantId, PLANT_IDS, PLANT_NAMES } from '../api/_lib/plants.js';
import { createSignedActionUrl, verifySignedActionToken, verifySignedActionUrl, isActionNonceConsumed } from '../api/_lib/actions.js';
import { getSenderAddress, sendTransactionalEmail } from '../api/_lib/email.js';
import { deliverOrderRequest, resolveRegisteredPlantUsers } from '../api/_lib/orderEmailFlow.js';

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

test('plant aliases normalize exactly and ambiguous strings are rejected', () => {
  const aliases = {
    LT: ['LT', 'Lanka Tiles', 'Lanka Tile', 'Lanka-Tiles', 'lankatiles'],
    LWT: ['LWT', 'Lanka Wall Tiles', 'Lanka Wall Tile', 'Lanka_Wall_Tiles'],
    RCLH: ['RCLH', 'RCL-H', 'RCL H', 'Rocell Horana', 'Horana'],
    RCLE: ['RCLE', 'RCL-E', 'RCL E', 'Rocell Eheliyagoda', 'Eheliyagoda']
  };
  for (const [id, values] of Object.entries(aliases)) {
    for (const value of values) assert.equal(normalizePlantId(value), id);
  }
  assert.throws(() => normalizePlantId('unknown lanka tile source'), /Unknown plant/i);
  assert.throws(() => normalizePlantId(''), /Plant is required/i);
});

test('recipient resolver sends LT request only to active registered LT emails, not LWT users', () => {
  const users = [
    { id: 'lt-1', data: { username: 'LT manager', email: 'lt.manager@example.com', factoryAffiliation: 'Lanka Tiles', approved: true } },
    { id: 'lt-2', data: { username: 'lt.backup@example.com', factoryAffiliation: 'LT', approved: true } },
    { id: 'lwt-1', data: { username: 'lwt.manager@example.com', factoryAffiliation: 'LWT', approved: true } },
    { id: 'lt-disabled', data: { email: 'inactive@example.com', factoryAffiliation: 'LT', approved: false } },
    { id: 'lt-bad-email', data: { email: 'not-an-email', factoryAffiliation: 'LT', approved: true } }
  ];

  const targetRecipients = resolveRegisteredPlantUsers(users, 'LT').map(user => user.email).sort();
  const requesterConfirmRecipients = resolveRegisteredPlantUsers(users, 'LWT').map(user => user.email);
  assert.deepEqual(targetRecipients, ['lt.backup@example.com', 'lt.manager@example.com']);
  assert.deepEqual(requesterConfirmRecipients, ['lwt.manager@example.com']);
});

test('signed action URLs validate and expire correctly', () => {
  const secret = 'test-secret';
  const url = createSignedActionUrl('ORD-42', 'approve', 'https://example.com', secret, 7 * 24 * 60 * 60 * 1000);

  const parsed = verifySignedActionUrl(url, secret);
  assert.equal(parsed.orderId, 'ORD-42');
  assert.equal(parsed.action, 'approve');
  assert.ok(parsed.nonce);
  assert.equal(isActionNonceConsumed([], parsed.nonce), false);
  assert.equal(isActionNonceConsumed([parsed.nonce], parsed.nonce), true);

  const expiredUrl = createSignedActionUrl('ORD-99', 'reject', 'https://example.com', secret, -1000);
  assert.throws(() => verifySignedActionUrl(expiredUrl, secret), /expired|Expired/i);
});

test('dry-run order mail separates target request from requesting-plant confirmation and uses SMTP_FROM', async () => {
  const previous = {
    EMAIL_DRY_RUN: process.env.EMAIL_DRY_RUN,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_FROM: process.env.SMTP_FROM,
    APP_URL: process.env.APP_URL,
    ACTION_SECRET: process.env.ACTION_SECRET
  };
  process.env.EMAIL_DRY_RUN = 'true';
  process.env.SMTP_FROM = 'SpareShare Enterprise Portal <sparevone@gmail.com>';
  process.env.SMTP_USER = 'sparevone@gmail.com';
  process.env.ACTION_SECRET = 'unit-test-only-secret';
  const users = [
    { id: 'lt', data: { username: 'lt.manager@example.com', factoryAffiliation: 'LT', approved: true } },
    { id: 'lwt', data: { username: 'lwt.manager@example.com', factoryAffiliation: 'LWT', approved: true } }
  ];
  const admin = { firestore: () => ({ collection: () => ({ get: async () => ({ docs: users.map(user => ({ data: () => user.data })) }) }) }) };

  try {
    const result = await deliverOrderRequest({
      admin,
      order: { id: 'ORD-TEST', requestedBy: 'lwt.manager@example.com', createdAt: Date.now(), items: [{ fromFactory: 'LT', sparePartId: 'LT-1', sparePartDescription: 'Test item', quantity: 1 }] },
      targetPlantId: 'LT',
      requestingPlantId: 'LWT',
      requesterEmail: 'lwt.manager@example.com'
    });
    assert.equal(result.status, 'sent');
    assert.equal(result.targetRecipientCount, 1);
    assert.equal(result.targetSent, 1);
    assert.equal(result.confirmationSent, 1);
    assert.equal(getSenderAddress(), 'SpareShare Enterprise Portal <sparevone@gmail.com>');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('dry-run mode logs the target recipient and preserves a sparevone sender', async () => {
  const previous = process.env.EMAIL_DRY_RUN;
  const previousUser = process.env.SMTP_USER;
  const previousSender = process.env.SMTP_FROM;
  process.env.EMAIL_DRY_RUN = 'true';
  process.env.SMTP_USER = 'sparevone@gmail.com';
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
    if (previousUser === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = previousUser;
    if (previousSender === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = previousSender;
  }
});

test('sender configuration rejects a different Gmail account', () => {
  const previousUser = process.env.SMTP_USER;
  const previousFrom = process.env.SMTP_FROM;
  process.env.SMTP_USER = 'wrong-account@example.com';
  process.env.SMTP_FROM = 'Other Sender <wrong-account@example.com>';
  try {
    assert.throws(() => getSenderAddress(), /only from sparevone@gmail.com/i);
  } finally {
    if (previousUser === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = previousUser;
    if (previousFrom === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = previousFrom;
  }
});

test('plant labels are stable and known', () => {
  assert.equal(PLANT_NAMES[PLANT_IDS.LT], 'Lanka Tiles');
  assert.equal(PLANT_NAMES[PLANT_IDS.LWT], 'Lanka Wall Tiles');
  assert.equal(PLANT_NAMES[PLANT_IDS.RCLH], 'Rocell Horana');
  assert.equal(PLANT_NAMES[PLANT_IDS.RCLE], 'Rocell Eheliyagoda');
});
