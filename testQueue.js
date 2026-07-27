import test from 'node:test';
import assert from 'node:assert';
import {
  EmailQueue,
  JOB_STATUS,
  orderEventEmitter,
  generateCustomerConfirmationEmail,
  generatePlantNotificationEmail
} from './emailQueue.js';

// Setup Mock Order Data
const mockOrder = {
  id: 'ord-test-12345',
  createdAt: Date.now(),
  requestedBy: 'buyer@gmail.com',
  userEmail: 'buyer@gmail.com',
  plantEmail: 'lankatiles.admin@gmail.com',
  totalValue: 5000,
  items: [
    {
      sparePartId: 'Lanka Tiles-100201',
      sparePartDescription: 'Ball Bearing 6204 DDU',
      partNumber: 'PN-998822',
      machine: 'Press Machine',
      fromFactory: 'Lanka Tiles',
      quantity: 2,
      unitCost: 2500,
      totalValue: 5000,
      status: 'pending'
    }
  ]
};

// 1. Test Event Emitter & Listeners
test('Event Emitter: emits OrderCreated and triggers listener', (t) => {
  return new Promise((resolve) => {
    orderEventEmitter.once('OrderCreated', (payload) => {
      assert.strictEqual(payload.order.id, 'ord-test-12345');
      assert.strictEqual(payload.userEmail, 'buyer@gmail.com');
      assert.strictEqual(payload.plantEmail, 'lankatiles.admin@gmail.com');
      resolve();
    });

    orderEventEmitter.emit('OrderCreated', {
      order: mockOrder,
      userEmail: 'buyer@gmail.com',
      plantEmail: 'lankatiles.admin@gmail.com',
      userFactory: 'Rocell Horana'
    });
  });
});

// 2. Test Email Queue Successful Processing
test('Email Queue: successfully processes job using mock transporter', async (t) => {
  let sentMail = false;
  const mockTransporter = {
    options: {
      host: 'smtp.test.com',
      auth: { user: 'test', pass: 'test' }
    },
    sendMail: (options, callback) => {
      sentMail = true;
      assert.strictEqual(options.to, 'buyer@gmail.com');
      assert.match(options.subject, /Order Confirmation/);
      callback(null, { messageId: 'msg-123' });
    }
  };

  const queue = new EmailQueue(mockTransporter);
  const job = queue.addJob({
    to: 'buyer@gmail.com',
    subject: 'Order Confirmation',
    text: 'Your order is confirmed.'
  });

  assert.strictEqual(job.status, JOB_STATUS.PROCESSING);

  // Wait for processing to complete
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.strictEqual(job.status, JOB_STATUS.SUCCESS);
  assert.strictEqual(sentMail, true);
  assert.strictEqual(queue.jobsProcessedCount, 1);
});

// 3. Test Email Queue Retries with Backoff
test('Email Queue: retries on failure and eventually succeeds', async (t) => {
  let attempts = 0;
  const mockTransporter = {
    options: {
      host: 'smtp.test.com',
      auth: { user: 'test', pass: 'test' }
    },
    sendMail: (options, callback) => {
      attempts++;
      if (attempts < 3) {
        callback(new Error('Network failure'));
      } else {
        callback(null, { messageId: 'msg-success' });
      }
    }
  };

  // Configure quick retries for unit tests
  const queue = new EmailQueue(mockTransporter, {
    maxRetries: 3,
    initialBackoffMs: 10
  });

  const job = queue.addJob({
    to: 'retry@gmail.com',
    subject: 'Retry Test',
    text: 'Test body'
  });

  assert.strictEqual(job.status, JOB_STATUS.PROCESSING);

  // Wait long enough for retries (attempts 1, 2, 3) to execute
  await new Promise(resolve => setTimeout(resolve, 200));

  assert.strictEqual(job.status, JOB_STATUS.SUCCESS);
  assert.strictEqual(attempts, 3);
  assert.strictEqual(queue.jobsProcessedCount, 1);
});

// 4. Test Email Queue Permanent Failure
test('Email Queue: fails permanently after maximum retries are exhausted', async (t) => {
  let attempts = 0;
  const mockTransporter = {
    options: {
      host: 'smtp.test.com',
      auth: { user: 'test', pass: 'test' }
    },
    sendMail: (options, callback) => {
      attempts++;
      callback(new Error('SMTP authentication failed'));
    }
  };

  const queue = new EmailQueue(mockTransporter, {
    maxRetries: 3,
    initialBackoffMs: 5
  });

  const job = queue.addJob({
    to: 'fail@gmail.com',
    subject: 'Failure Test',
    text: 'Test body'
  });

  // Wait for all retries to fail
  await new Promise(resolve => setTimeout(resolve, 150));

  assert.strictEqual(job.status, JOB_STATUS.FAILED);
  assert.strictEqual(attempts, 3);
  assert.strictEqual(queue.jobsFailedCount, 1);
});

// 5. Test Email HTML Templates Formatting
test('HTML Templates: generates correct, visually styled email strings', (t) => {
  const userHtml = generateCustomerConfirmationEmail(
    mockOrder,
    'buyer@gmail.com',
    '5 Business Days'
  );

  assert.match(userHtml, /<!DOCTYPE html>/);
  assert.match(userHtml, /buyer@gmail\.com/);
  assert.match(userHtml, /ord-test-12345/);
  assert.match(userHtml, /Ball Bearing 6204 DDU/);
  assert.match(userHtml, /5 Business Days/);
  assert.match(userHtml, /Rs\.\s5,000/);

  const plantHtml = generatePlantNotificationEmail(
    mockOrder,
    'lankatiles.admin@gmail.com',
    'Rocell Horana',
    'buyer@gmail.com'
  );

  assert.match(plantHtml, /<!DOCTYPE html>/);
  assert.match(plantHtml, /lankatiles\.admin@gmail\.com/);
  assert.match(plantHtml, /Rocell Horana/);
  assert.match(plantHtml, /buyer@gmail\.com/);
  assert.match(plantHtml, /Ball Bearing 6204 DDU/);
  assert.match(plantHtml, /Operations Checklist/);
});
