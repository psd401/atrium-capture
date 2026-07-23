import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const macOSIndexPath = path.join(repositoryRoot, 'openwiki', 'macos', 'index.md');
const checkOnly = process.argv.includes('--check');

const source = await readFile(macOSIndexPath, 'utf8');
const normalized = normalizeMacOSIndex(source);

if (normalized === source) {
  console.log('OpenWiki canonical terms are current.');
} else if (checkOnly) {
  console.error('OpenWiki canonical terms are stale. Run pnpm openwiki:normalize.');
  process.exitCode = 1;
} else {
  await writeFile(macOSIndexPath, normalized);
  console.log('Normalized OpenWiki canonical terms.');
}

function normalizeMacOSIndex(value) {
  const titlePattern = /^title:\s*(?:"Macos"|'Macos'|Macos|"macOS"|'macOS'|macOS)\s*$/m;
  const descriptionPattern =
    /^description:\s*(?:"Files and subdirectories in (?:Macos|macOS)\."|'Files and subdirectories in (?:Macos|macOS)\.'|Files and subdirectories in (?:Macos|macOS)\.)\s*$/m;

  if (!titlePattern.test(value) || !descriptionPattern.test(value)) {
    throw new Error('openwiki_macos_index_shape_unexpected');
  }

  return value
    .replace(titlePattern, "title: 'macOS'")
    .replace(descriptionPattern, "description: 'Files and subdirectories in macOS.'");
}
