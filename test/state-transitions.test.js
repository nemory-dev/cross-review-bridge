// Regression tests for illegal lifecycle transitions.
//
// Pinned as `todo` in Step 0, passing as of Step 1: completeReview now requires a
// live claim held by the completing reviewer and treats a completed result as
// immutable, and cancelReview refuses a completed review.
//
// Reference: docs/orca-comparison-review.md section B2.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cancelReview, claimReview, completeReview, createReview, getReview } from '../src/store.js';

async function withStore(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-transition-'));
  const storePath = path.join(dir, 'reviews.db');
  try {
    return await run(storePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function seed(storePath, subject = 'subject') {
  return createReview({ storePath, target: 'claude', source: 'codex', subject });
}

test('completing an unclaimed review is rejected', async () => {
  await withStore(async (storePath) => {
    const review = await seed(storePath);

    await assert.rejects(
      () => completeReview({ storePath, id: review.id, reviewer: 'nobody', result: 'feedback' }),
      /claim/i
    );

    assert.equal((await getReview({ storePath, id: review.id })).status, 'pending');
  });
});

test('completing a review claimed by someone else is rejected', async () => {
  await withStore(async (storePath) => {
    const review = await seed(storePath);
    await claimReview({ storePath, target: 'claude', reviewer: 'claude-code' });

    await assert.rejects(
      () => completeReview({ storePath, id: review.id, reviewer: 'impostor', result: 'feedback' }),
      /claim|owner|reviewer/i
    );

    const stored = await getReview({ storePath, id: review.id });
    assert.equal(stored.status, 'claimed');
    assert.equal(stored.result, undefined);
  });
});

test('re-completing a completed review does not overwrite the original result', async () => {
  await withStore(async (storePath) => {
    const review = await seed(storePath);
    await claimReview({ storePath, target: 'claude', reviewer: 'claude-code' });
    await completeReview({ storePath, id: review.id, reviewer: 'claude-code', result: 'original' });

    await assert.rejects(
      () => completeReview({ storePath, id: review.id, reviewer: 'claude-code', result: 'overwritten' }),
      /completed|terminal|immutable/i
    );

    assert.equal((await getReview({ storePath, id: review.id })).result.body, 'original');
  });
});

test('cancelling a completed review is rejected', async () => {
  await withStore(async (storePath) => {
    const review = await seed(storePath);
    await claimReview({ storePath, target: 'claude', reviewer: 'claude-code' });
    await completeReview({ storePath, id: review.id, reviewer: 'claude-code', result: 'original' });

    await assert.rejects(
      () => cancelReview({ storePath, id: review.id, reason: 'changed my mind' }),
      /completed|terminal/i
    );

    assert.equal((await getReview({ storePath, id: review.id })).status, 'completed');
  });
});
