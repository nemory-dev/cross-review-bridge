import { existsSync } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT_MARKERS = ['.git', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'package.json'];
const ROOT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];

export function toPosixPath(filePath) {
  return filePath ? filePath.replace(/\\/g, '/') : '';
}

export async function readContextDocument(root, inputPath, maxChars = 12000) {
  if (!inputPath || typeof inputPath !== 'string' || !inputPath.trim()) {
    return null;
  }

  const nativeRoot = path.resolve(root || process.cwd());
  const nativePath = path.resolve(nativeRoot, inputPath.trim());
  const relativePath = path.relative(nativeRoot, nativePath);
  const displayPath = toPosixPath(relativePath || path.basename(nativePath));

  const isInside = nativePath === nativeRoot || nativePath.startsWith(nativeRoot + path.sep);
  if (!isInside) {
    return {
      path: displayPath,
      nativePath,
      content: null,
      truncated: false,
      error: `Access denied: Path "${displayPath}" is outside project root.`
    };
  }

  if (!(await isFile(nativePath))) {
    return {
      path: displayPath,
      nativePath,
      content: null,
      truncated: false,
      error: `File not found or unreadable: "${displayPath}".`
    };
  }

  try {
    let realRoot = nativeRoot;
    let realPath = nativePath;
    try {
      realRoot = await realpath(nativeRoot);
      realPath = await realpath(nativePath);
    } catch {
      // Fallback if realpath fails
    }

    const isInsideReal = realPath === realRoot || realPath.startsWith(realRoot + path.sep);
    if (!isInsideReal) {
      return {
        path: displayPath,
        nativePath,
        content: null,
        truncated: false,
        error: `Access denied: Symlink target "${displayPath}" points outside project root.`
      };
    }

    const raw = await readFile(nativePath, 'utf8');
    const content = raw.slice(0, maxChars);
    return {
      path: displayPath,
      nativePath,
      content,
      truncated: raw.length > content.length,
      error: null
    };
  } catch (error) {
    return {
      path: displayPath,
      nativePath,
      content: null,
      truncated: false,
      error: `Failed to read file "${displayPath}": ${error.message}`
    };
  }
}

export async function findProjectRoot(startCwd = process.cwd()) {
  let current = path.resolve(startCwd);

  while (true) {
    if (await hasRootMarker(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startCwd);
    }
    current = parent;
  }
}

export async function collectProjectContext({
  cwd = process.cwd(),
  maxInstructionChars = 12000
} = {}) {
  const resolvedCwd = path.resolve(cwd);
  const root = await findProjectRoot(resolvedCwd);
  const instructions = await collectInstructions(root, maxInstructionChars);

  return {
    root: toPosixPath(root),
    cwd: toPosixPath(resolvedCwd),
    instructions,
    git: collectGitSummary(root)
  };
}

async function hasRootMarker(dir) {
  for (const marker of ROOT_MARKERS) {
    if (await exists(path.join(dir, marker))) {
      return true;
    }
  }
  return false;
}

async function collectInstructions(root, maxInstructionChars) {
  const files = [];

  for (const file of ROOT_INSTRUCTION_FILES) {
    files.push(file);
  }

  const cursorRulesDir = path.join(root, '.cursor', 'rules');
  if (await exists(cursorRulesDir)) {
    for (const entry of await readdir(cursorRulesDir)) {
      if (entry.endsWith('.md') || entry.endsWith('.mdc')) {
        files.push(toPosixPath(path.join('.cursor', 'rules', entry)));
      }
    }
  }

  const results = [];
  let remaining = maxInstructionChars;

  for (const relativePath of files) {
    if (remaining <= 0) break;

    const absolutePath = path.join(root, relativePath);
    if (!(await isFile(absolutePath))) continue;

    const raw = await readFile(absolutePath, 'utf8');
    const content = raw.slice(0, remaining);
    remaining -= content.length;
    results.push({
      path: toPosixPath(relativePath),
      content,
      truncated: raw.length > content.length
    });
  }

  return results;
}

function collectGitSummary(root) {
  if (!existsSyncSafe(path.join(root, '.git'))) {
    return null;
  }

  const branch = spawnSync('git', ['-C', root, 'branch', '--show-current'], {
    encoding: 'utf8'
  });
  const status = spawnSync('git', ['-C', root, 'status', '--short'], {
    encoding: 'utf8'
  });

  return {
    branch: branch.status === 0 ? branch.stdout.trim() : '',
    statusShort: status.status === 0 ? status.stdout.trim() : ''
  };
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function isFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function existsSyncSafe(filePath) {
  return existsSync(filePath);
}

