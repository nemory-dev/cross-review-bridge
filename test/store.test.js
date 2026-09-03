import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cancelReview,
  claimReview,
  completeReview,
  createReview,
  getReview,
  listReviews
} from '../src/store.js';

test('review lifecycle moves from pending to claimed to completed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-store-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    const created = await createReview({
      storePath,
      target: 'claude',
      source: 'codex',
      subject: 'Use a singleton for all agent memory.',
      reviewGoal: 'Check architecture risk',
      reviewGuide: 'Focus on coupling and future extension.',
      project: {
        root: '/repo',
        cwd: '/repo',
        instructions: []
      }
    });

    assert.equal(created.status, 'pending');
    assert.equal(created.target, 'claude');
    assert.ok(created.id);

    const pending = await listReviews({ storePath, status: 'pending', target: 'claude' });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, created.id);

    const claimed = await claimReview({ storePath, target: 'claude', reviewer: 'claude-code' });
    assert.equal(claimed.id, created.id);
    assert.equal(claimed.status, 'claimed');
    assert.equal(claimed.claimedBy, 'claude-code');

    const noSecondClaim = await claimReview({ storePath, target: 'claude', reviewer: 'other' });
    assert.equal(noSecondClaim, null);

    const completed = await completeReview({
      storePath,
      id: created.id,
      reviewer: 'claude-code',
      result: 'This is too global. Prefer an injected store interface.'
    });

    assert.equal(completed.status, 'completed');
    assert.equal(completed.result.reviewer, 'claude-code');
    assert.match(completed.result.body, /injected store/);

    const loaded = await getReview({ storePath, id: created.id });
    assert.equal(loaded.status, 'completed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cancelReview records a cancelled review with a reason', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-store-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    const created = await createReview({
      storePath,
      target: 'codex',
      source: 'claude',
      subject: 'Review this plan.',
      reviewGoal: 'Find missing tests',
      reviewGuide: '',
      project: {
        root: '/repo',
        cwd: '/repo',
        instructions: []
      }
    });

    const cancelled = await cancelReview({
      storePath,
      id: created.id,
      reason: 'User changed direction'
    });

    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancelReason, 'User changed direction');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

