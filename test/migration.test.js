// The store moved from a JSON file to SQLite in Step 3. Existing users have real
// history in ~/.cross-review-bridge/reviews.json, so the first open of a new
// database imports it once and leaves the JSON file in place.
//
// Reference: docs/orca-comparison-review.md section D4.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claimReview, createReview, getReview, listReviews } from '../src/store.js';

const LEGACY = {
  reviews: [
    {
      id: 'legacy-completed',
      status: 'completed',
      target: 'claude',
      source: 'codex',
      subject: 'an answer reviewed before the migration',
      createdAt: '2026-01-01T00:00:00.000Z',
      claimedBy: 'claude-code',
      result: { reviewer: 'claude-code', body: 'earlier feedback', completedAt: '2026-01-01T01:00:00.000Z' }
    },
    {
      id: 'legacy-pending',
      status: 'pending',
      target: 'codex',
      source: 'claude',
      subject: 'still waiting for a reviewer',
      createdAt: '2026-01-02T00:00:00.000Z'
    }
  ]
};

async function withLegacyStore(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-migrate-'));
  const legacyPath = path.join(dir, 'reviews.json');
  const storePath = path.join(dir, 'reviews.db');
  try {
    await writeFile(legacyPath, `${JSON.stringify(LEGACY, null, 2)}\n`, 'utf8');
    return await run({ storePath, legacyPath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a legacy JSON store is imported on first open', async () => {
  await withLegacyStore(async ({ storePath }) => {
    const reviews = await listReviews({ storePath });
    assert.equal(reviews.length, 2);

    const completed = await getReview({ storePath, id: 'legacy-completed' });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.result.body, 'earlier feedback');
    assert.equal(completed.subject, 'an answer reviewed before the migration');

    const claimed = await claimReview({ storePath, target: 'codex', reviewer: 'codex-cli' });
    assert.equal(claimed.id, 'legacy-pending');
    assert.equal(claimed.status, 'claimed');
  });
});

test('the legacy JSON file is left in place and imported only once', async () => {
  await withLegacyStore(async ({ storePath, legacyPath }) => {
    await createReview({ storePath, target: 'claude', source: 'codex', subject: 'after migration' });

    // A second open must not re-import, which would resurrect rows and duplicate ids.
    const reviews = await listReviews({ storePath });
    assert.equal(reviews.length, 3);

    const untouched = JSON.parse(await readFile(legacyPath, 'utf8'));
    assert.equal(untouched.reviews.length, 2);
  });
});

test('completing a migrated review still honours the claim owner', async () => {
  await withLegacyStore(async ({ storePath }) => {
    await claimReview({ storePath, target: 'codex', reviewer: 'codex-cli' });

    await assert.rejects(
      () =>
        import('../src/store.js').then(({ completeReview }) =>
          completeReview({ storePath, id: 'legacy-pending', reviewer: 'someone-else', result: 'x' })
        ),
      /claimed by/i
    );
  });
});
