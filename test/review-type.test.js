import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { renderReviewPrompt } from '../src/prompt.js';
import { createReview, getReview } from '../src/store.js';

test('createReview and renderReviewPrompt handle PLAN_AND_PROPOSAL review type', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-test-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    const review = await createReview({
      storePath,
      target: 'claude',
      source: 'codex',
      subject: 'Proposed architecture for budget reservation',
      reviewType: 'PLAN_AND_PROPOSAL',
      proposedPlanFile: 'docs\\architecture_plan.md',
      contextDocuments: ['docs\\decisions.md', 'spec.md'],
      reviewQuestions: [
        'Does this conflict with existing token reservation?',
        'What edge cases are missing?'
      ]
    });

    assert.equal(review.reviewType, 'PLAN_AND_PROPOSAL');
    assert.equal(review.proposedPlanFile, 'docs/architecture_plan.md');
    assert.deepEqual(review.contextDocuments, ['docs/decisions.md', 'spec.md']);
    assert.equal(review.reviewQuestions.length, 2);

    const fetched = await getReview({ storePath, id: review.id });
    assert.equal(fetched.reviewType, 'PLAN_AND_PROPOSAL');

    const promptText = renderReviewPrompt(fetched);
    assert.match(promptText, /Review Type: PLAN_AND_PROPOSAL/);
    assert.match(promptText, /Act as a Plan Critic & Peer Logic Checker/);
    assert.match(promptText, /Key Questions To Address/);
    assert.match(promptText, /Does this conflict with existing token reservation\?/);
    assert.match(promptText, /Proposed Plan File/);
    assert.match(promptText, /docs\/architecture_plan\.md/);
    assert.match(promptText, /Context Documents/);
    assert.match(promptText, /docs\/decisions\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createReview and renderReviewPrompt handle CODE_DIFF review type', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-test-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    const review = await createReview({
      storePath,
      target: 'codex',
      source: 'antigravity',
      subject: 'git diff src/index.js',
      reviewType: 'CODE_DIFF'
    });

    assert.equal(review.reviewType, 'CODE_DIFF');
    const promptText = renderReviewPrompt(review);
    assert.match(promptText, /Review Type: CODE_DIFF/);
    assert.match(promptText, /Act as a Spec & Code Validator/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createReview throws Error on invalid reviewType', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-test-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    await assert.rejects(
      async () => {
        await createReview({
          storePath,
          target: 'claude',
          subject: 'Invalid type test',
          reviewType: 'codde'
        });
      },
      /Invalid reviewType: "codde"/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
