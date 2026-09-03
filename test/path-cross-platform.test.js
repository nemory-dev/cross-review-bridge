import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { toPosixPath } from '../src/context.js';
import { createReview } from '../src/store.js';

test('toPosixPath converts Windows backslashes to POSIX forward slashes', () => {
  assert.equal(toPosixPath('C:\\Users\\test\\project\\file.md'), 'C:/Users/test/project/file.md');
  assert.equal(toPosixPath('.cursor\\rules\\review.md'), '.cursor/rules/review.md');
  assert.equal(toPosixPath('docs/architecture.md'), 'docs/architecture.md');
  assert.equal(toPosixPath(''), '');
  assert.equal(toPosixPath(null), '');
});

test('createReview normalizes proposedPlanFile and contextDocuments paths regardless of OS input', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-path-test-'));
  const storePath = path.join(dir, 'reviews.json');

  try {
    const review = await createReview({
      storePath,
      target: 'claude',
      subject: 'Cross-platform path test',
      proposedPlanFile: 'subfolder\\nested\\plan.md',
      contextDocuments: ['docs\\adr\\001.md', 'specs/api.md', 'root\\config.json']
    });

    assert.equal(review.proposedPlanFile, 'subfolder/nested/plan.md');
    assert.deepEqual(review.reviewType, 'PLAN_AND_PROPOSAL');
    assert.deepEqual(review.contextDocuments, [
      'docs/adr/001.md',
      'specs/api.md',
      'root/config.json'
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
