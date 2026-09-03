import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function findJsFiles(dir) {
  const results = [];
  if (!readdirSync) return results;

  try {
    const list = readdirSync(dir);
    for (const item of list) {
      const fullPath = path.join(dir, item);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...findJsFiles(fullPath));
      } else if (stat.isFile() && item.endsWith('.js')) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err.message);
  }
  return results;
}

const rootDir = process.cwd();
const srcFiles = findJsFiles(path.join(rootDir, 'src'));
const testFiles = findJsFiles(path.join(rootDir, 'test'));
const allFiles = [...srcFiles, ...testFiles];

if (allFiles.length === 0) {
  console.log('No JavaScript files found to check.');
  process.exit(0);
}

console.log(`Checking syntax for ${allFiles.length} JavaScript files...`);
const res = spawnSync(process.execPath, ['--check', ...allFiles], { stdio: 'inherit' });

if (res.status !== 0) {
  process.exit(res.status || 1);
}
