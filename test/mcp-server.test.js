import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const SERVER = path.resolve('src/mcp-server.js');

test('MCP server lists tools and submits a review', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-mcp-'));
  const storePath = path.join(dir, 'reviews.db');

  try {
    const server = spawn(process.execPath, [SERVER], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        CROSS_REVIEW_HOME: dir
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const client = createJsonRpcClient(server);

    const tools = await client.request('tools/list', {});
    assert.ok(tools.tools.some((tool) => tool.name === 'submit_review'));

    const submit = await client.request('tools/call', {
      name: 'submit_review',
      arguments: {
        storePath,
        target: 'claude',
        source: 'codex',
        subject: 'Prefer a single queue for all apps.',
        reviewGoal: 'Check product design',
        reviewGuide: 'Focus on future Antigravity support.',
        cwd: dir
      }
    });

    const payload = JSON.parse(submit.content[0].text);
    assert.equal(payload.status, 'pending');
    assert.equal(payload.target, 'claude');

    server.kill();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function createJsonRpcClient(child) {
  let nextId = 1;
  let buffer = '';
  const pending = new Map();

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
      }
      newlineIndex = buffer.indexOf('\n');
    }
  });

  return {
    request(method, params) {
      const id = nextId;
      nextId += 1;
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 2000);
        pending.set(id, (message) => {
          clearTimeout(timeout);
          pending.delete(id);
          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
        });
      });
    }
  };
}

