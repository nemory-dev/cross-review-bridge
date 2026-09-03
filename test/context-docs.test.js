import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readContextDocument } from '../src/context.js';
import { renderReviewPrompt } from '../src/prompt.js';
import { createReview } from '../src/store.js';

test('readContextDocument reads actual file content within project root', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'xreview-doc-root-'));
  const docsDir = path.join(rootDir, 'docs');
  const planFile = path.join(docsDir, 'plan.md');

  try {
    await mkdir(docsDir, { recursive: true });
    await writeFile(planFile, '# Architecture Plan\nUse Outbox pattern for billing.', 'utf8');

    const doc = await readContextDocument(rootDir, 'docs/plan.md');
    assert.equal(doc.path, 'docs/plan.md');
    assert.equal(doc.error, null);
    assert.match(doc.content, /# Architecture Plan/);
    assert.equal(doc.truncated, false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('readContextDocument rejects path traversal outside project root', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'xreview-doc-root-'));
  const outsideFile = path.join(tmpdir(), 'outside_secret.txt');

  try {
    await writeFile(outsideFile, 'secret content', 'utf8');

    const doc = await readContextDocument(rootDir, '../outside_secret.txt');
    assert.equal(doc.content, null);
    assert.match(doc.error, /Access denied: Path ".*" is outside project root/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test('readContextDocument rejects symlinks targeting files outside project root', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'xreview-sym-root-'));
  const outsideFile = path.join(tmpdir(), 'outside_sym_target.txt');
  const linkFile = path.join(rootDir, 'secret_link.md');

  try {
    await writeFile(outsideFile, 'outside secret data', 'utf8');
    try {
      await symlink(outsideFile, linkFile);
    } catch {
      // Symlink creation might require elevated privileges on Windows, skip gracefully if unsupported
      return;
    }

    const doc = await readContextDocument(rootDir, 'secret_link.md');
    assert.equal(doc.content, null);
    assert.match(doc.error, /Access denied: Symlink target ".*" points outside project root/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test('createReview respects total context size budget MAX_TOTAL_CONTEXT_CHARS', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'xreview-budget-root-'));
  const storePath = path.join(rootDir, 'reviews.db');
  const hugePlan = path.join(rootDir, 'huge_plan.md');
  const doc2 = path.join(rootDir, 'doc2.md');
  const doc3 = path.join(rootDir, 'doc3.md');
  const doc4 = path.join(rootDir, 'doc4.md');

  try {
    // MAX_TOTAL_CONTEXT_CHARS = 36,000
    // hugePlan: 15,000 chars -> capped at file limit 12,000 (remaining budget: 24,000)
    // doc2: 12,000 chars -> uses 12,000 (remaining budget: 12,000)
    // doc3: 10,000 chars -> uses 10,000 (remaining budget: 2,000)
    // doc4: 5,000 chars  -> capped at remaining budget 2,000
    await writeFile(hugePlan, 'A'.repeat(15000), 'utf8');
    await writeFile(doc2, 'B'.repeat(12000), 'utf8');
    await writeFile(doc3, 'C'.repeat(10000), 'utf8');
    await writeFile(doc4, 'D'.repeat(5000), 'utf8');

    const review = await createReview({
      storePath,
      target: 'claude',
      subject: 'Budget test',
      proposedPlanFile: 'huge_plan.md',
      contextDocuments: ['doc2.md', 'doc3.md', 'doc4.md'],
      project: { root: rootDir }
    });

    assert.equal(review.proposedPlanDoc.content.length, 12000);
    assert.equal(review.contextDocs[0].content.length, 12000);
    assert.equal(review.contextDocs[1].content.length, 10000);
    assert.equal(review.contextDocs[2].content.length, 2000);
    assert.equal(review.contextDocs[2].truncated, true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('createReview captures document contents and renderReviewPrompt embeds markdown codeblocks', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'xreview-full-root-'));
  const storePath = path.join(rootDir, 'reviews.db');
  const planPath = path.join(rootDir, 'plan.md');
  const adrPath = path.join(rootDir, 'adr.md');

  try {
    await writeFile(planPath, 'Plan content goes here.', 'utf8');
    await writeFile(adrPath, 'ADR-001: Strict budget reservation.', 'utf8');

    const review = await createReview({
      storePath,
      target: 'claude',
      subject: 'Review our architecture plan',
      reviewType: 'PLAN_AND_PROPOSAL',
      proposedPlanFile: 'plan.md',
      contextDocuments: ['adr.md'],
      project: { root: rootDir, cwd: rootDir }
    });

    assert.equal(review.proposedPlanDoc.content, 'Plan content goes here.');
    assert.equal(review.contextDocs[0].content, 'ADR-001: Strict budget reservation.');

    const promptText = renderReviewPrompt(review);
    assert.match(promptText, /## Proposed Plan File/);
    assert.match(promptText, /Plan content goes here\./);
    assert.match(promptText, /## Context Documents/);
    assert.match(promptText, /ADR-001: Strict budget reservation\./);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('CLI --type code applies CODE_DIFF default prompt correctly', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-cli-test-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    const cliPath = path.resolve('src/cli.js');
    const submitOutput = execFileSync(
      process.execPath,
      [cliPath, 'review', '--type', 'code', '--store', storePath, 'Review this diff'],
      { encoding: 'utf8' }
    );

    const review = JSON.parse(submitOutput);
    assert.equal(review.reviewType, 'CODE_DIFF');
    assert.equal(review.reviewGoal, '');

    const promptOutput = execFileSync(
      process.execPath,
      [cliPath, 'prompt', review.id, '--store', storePath],
      { encoding: 'utf8' }
    );

    assert.match(promptOutput, /Review Type: CODE_DIFF/);
    assert.match(promptOutput, /Act as a Spec & Code Validator/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI throws error on invalid --type', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-cli-test-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    const cliPath = path.resolve('src/cli.js');
    assert.throws(() => {
      execFileSync(
        process.execPath,
        [cliPath, 'review', '--type', 'codde', '--store', storePath, 'Bad type'],
        { encoding: 'utf8', stdio: 'pipe' }
      );
    }, /Invalid reviewType: "codde"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
