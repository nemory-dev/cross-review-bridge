import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const CLI = path.resolve('src/cli.js');

test('CLI submits and claims a review request', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-cli-'));
  const storePath = path.join(dir, 'reviews.db');
  const subjectPath = path.join(dir, 'answer.md');

  try {
    await writeFile(subjectPath, 'Use one global agent for all reviews.\n', 'utf8');

    const submit = runCli([
      'submit',
      '--store',
      storePath,
      '--target',
      'claude',
      '--source',
      'codex',
      '--subject-file',
      subjectPath,
      '--goal',
      'Find architectural risks',
      '--guide',
      'Focus on extensibility.'
    ]);

    assert.equal(submit.status, 0, submit.stderr);
    const submitted = JSON.parse(submit.stdout);
    assert.equal(submitted.status, 'pending');
    assert.equal(submitted.target, 'claude');

    const claim = runCli([
      'claim',
      '--store',
      storePath,
      '--target',
      'claude',
      '--reviewer',
      'claude-code',
      '--format',
      'prompt'
    ]);

    assert.equal(claim.status, 0, claim.stderr);
    assert.match(claim.stdout, /Cross Review Request/);
    assert.match(claim.stdout, /Find architectural risks/);
    assert.match(claim.stdout, /Use one global agent/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI submit accepts positional subject and defaults codex reviews to claude', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-cli-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    const submit = runCli([
      'submit',
      'Review this implementation plan.',
      '--store',
      storePath
    ]);

    assert.equal(submit.status, 0, submit.stderr);
    const submitted = JSON.parse(submit.stdout);
    assert.equal(submitted.source, 'codex');
    assert.equal(submitted.target, 'claude');
    assert.equal(submitted.subject, 'Review this implementation plan.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI submit defaults claude reviews to codex when source is claude', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-cli-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    const submit = runCli([
      'submit',
      'Check this Claude plan.',
      '--store',
      storePath,
      '--source',
      'claude'
    ]);

    assert.equal(submit.status, 0, submit.stderr);
    const submitted = JSON.parse(submit.stdout);
    assert.equal(submitted.source, 'claude');
    assert.equal(submitted.target, 'codex');
    assert.equal(submitted.subject, 'Check this Claude plan.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI review alias submits with review defaults', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-cli-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    const submit = runCli([
      'review',
      'Natural language review request.',
      '--store',
      storePath
    ]);

    assert.equal(submit.status, 0, submit.stderr);
    const submitted = JSON.parse(submit.stdout);
    assert.equal(submitted.source, 'codex');
    assert.equal(submitted.target, 'claude');
    assert.equal(submitted.reviewGoal, 'Critically review this answer or plan.');
    assert.match(submitted.reviewGuide, /correctness/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: path.resolve('.'),
    encoding: 'utf8'
  });
}
