import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectProjectContext, findProjectRoot, toPosixPath } from '../src/context.js';

test('findProjectRoot walks up to git or instruction files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-context-'));
  const nested = path.join(dir, 'apps', 'web');

  try {
    await mkdir(nested, { recursive: true });
    await mkdir(path.join(dir, '.git'));

    const root = await findProjectRoot(nested);
    assert.equal(toPosixPath(root), toPosixPath(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectProjectContext captures bounded project instructions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xreview-context-'));
  const nested = path.join(dir, 'packages', 'app');

  try {
    await mkdir(nested, { recursive: true });
    await mkdir(path.join(dir, '.cursor', 'rules'), { recursive: true });
    await writeFile(path.join(dir, 'AGENTS.md'), 'Answer in Korean.\nRespect project style.\n', 'utf8');
    await writeFile(path.join(dir, 'CLAUDE.md'), 'Claude-specific project notes.\n', 'utf8');
    await writeFile(path.join(dir, '.cursor', 'rules', 'review.md'), 'Cursor rule body.\n', 'utf8');

    const context = await collectProjectContext({ cwd: nested, maxInstructionChars: 2000 });

    assert.equal(context.root, toPosixPath(dir));
    assert.equal(context.cwd, toPosixPath(nested));
    assert.deepEqual(
      context.instructions.map((item) => item.path).sort(),
      ['.cursor/rules/review.md', 'AGENTS.md', 'CLAUDE.md']
    );
    assert.match(context.instructions[0].content, /Answer in Korean|Claude-specific|Cursor rule/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


