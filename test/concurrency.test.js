// Regression tests for concurrency defects.
//
// The MCP serialization test passes as of Step 1. The remaining three assert the
// DESIRED behavior of the store itself, which needs cross-process atomicity the
// JSON backend cannot provide; they stay `todo` until the node:sqlite migration
// in Step 3 and are the acceptance criteria for it.
//
// Reference: docs/orca-comparison-review.md sections B1, C1, and D4.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { claimReview, createReview, listReviews } from '../src/store.js';

const STORE_URL = pathToFileURL(path.resolve('src/store.js')).href;
const SERVER = path.resolve('src/mcp-server.js');

// B1, request layer: two claim_review calls delivered in one stdin write reach
// readline as two synchronous `line` events. Before Step 1 the async listener
// interleaved at every await and both calls returned the same review.
test('the MCP server serializes claims arriving in one write', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-mcp-race-'));
  const storePath = path.join(dir, 'reviews.json');

  try {
    await createReview({ storePath, target: 'claude', source: 'codex', subject: 'race' });

    const server = spawn(process.execPath, [SERVER], {
      env: { ...process.env, CROSS_REVIEW_HOME: dir },
      stdio: ['pipe', 'pipe', 'ignore']
    });

    try {
      const payloads = await claimTwiceInOneWrite(server, storePath);
      const winners = payloads.filter((payload) => payload !== null);
      assert.equal(winners.length, 1, `expected 1 winner, got ${winners.length}`);
    } finally {
      server.kill();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function claimTwiceInOneWrite(server, storePath) {
  const call = (id, reviewer) => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'claim_review', arguments: { storePath, target: 'claude', reviewer } }
  });

  return new Promise((resolve, reject) => {
    const responses = [];
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('timed out waiting for claim responses')), 5000);

    server.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) responses.push(JSON.parse(JSON.parse(line).result.content[0].text));
        newline = buffer.indexOf('\n');
      }
      if (responses.length === 2) {
        clearTimeout(timer);
        resolve(responses);
      }
    });

    // One write, so both requests land in the same chunk.
    server.stdin.write(`${JSON.stringify(call(1, 'claude-code'))}\n${JSON.stringify(call(2, 'codex-cli'))}\n`);
  });
}

// B1 (a): a single process — mcp-server.js handles JSON-RPC requests with
// `rl.on('line', async ...)` and no serialization queue, so two claim requests
// interleave at every await point.
test('two concurrent claims in one process yield exactly one winner', { todo: true }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-conc-'));
  const storePath = path.join(dir, 'reviews.json');

  try {
    await createReview({ storePath, target: 'claude', source: 'codex', subject: 'race' });

    const results = await Promise.all([
      claimReview({ storePath, target: 'claude', reviewer: 'claude-code' }),
      claimReview({ storePath, target: 'claude', reviewer: 'codex-cli' })
    ]);

    const winners = results.filter(Boolean);
    assert.equal(winners.length, 1, `expected 1 winner, got ${winners.length}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// C1: `writeStore` builds its temp path from pid + milliseconds, so two writes
// in the same process and millisecond collide. One rename consumes the other's
// temp file and the loser throws ENOENT.
test('concurrent submits in one process all persist', { todo: true }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-conc-'));
  const storePath = path.join(dir, 'reviews.json');

  try {
    const submissions = Array.from({ length: 8 }, (_, index) =>
      createReview({ storePath, target: 'claude', source: 'codex', subject: `review-${index}` })
    );

    const settled = await Promise.allSettled(submissions);
    const failed = settled.filter((entry) => entry.status === 'rejected');
    assert.equal(failed.length, 0, `writes threw: ${failed.map((f) => f.reason?.code).join(',')}`);

    const stored = await listReviews({ storePath });
    assert.equal(stored.length, 8, `expected 8 stored reviews, got ${stored.length}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// B1 (b): separate processes. An unsynchronized spawn does not reproduce the
// race because Node startup jitter (~50ms) dwarfs the read-modify-write window
// (~1ms). Each worker therefore busy-waits until a shared deadline so that all
// of them read the same snapshot.
//
// Measured on Windows 11 / Node 24: 12 workers produced 5 successful claims and
// 7 EPERM crashes. Distinct pids mean no temp-name collision, so a unique temp
// name alone does not fix this — see docs/orca-comparison-review.md C1.
test('barrier-aligned claims across processes yield exactly one winner', { todo: true }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-barrier-'));
  const storePath = path.join(dir, 'reviews.json');
  const workerPath = path.join(dir, 'worker.mjs');
  const workerCount = 12;

  try {
    await createReview({ storePath, target: 'claude', source: 'codex', subject: 'barrier' });
    await writeFile(workerPath, buildWorkerSource(), 'utf8');

    const deadline = Date.now() + 1500;
    const outputs = await Promise.all(
      Array.from({ length: workerCount }, (_, index) =>
        runWorker(workerPath, [storePath, `reviewer-${index}`, String(deadline)])
      )
    );

    const claimed = outputs.filter((line) => line.startsWith('CLAIMED'));
    const errored = outputs.filter((line) => line.startsWith('ERROR'));

    assert.equal(errored.length, 0, `workers crashed: ${errored.join(', ')}`);
    assert.equal(claimed.length, 1, `expected 1 winner, got ${claimed.length}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function buildWorkerSource() {
  return `const { claimReview } = await import(${JSON.stringify(STORE_URL)});
const [storePath, reviewer, deadline] = process.argv.slice(2);
while (Date.now() < Number(deadline)) {}
try {
  const review = await claimReview({ storePath, target: 'claude', reviewer });
  process.stdout.write(review ? 'CLAIMED ' + reviewer : 'EMPTY');
} catch (error) {
  process.stdout.write('ERROR ' + (error.code || error.message));
}
`;
}

function runWorker(workerPath, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [workerPath, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', () => resolve(output.trim()));
  });
}
