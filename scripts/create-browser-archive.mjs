import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBrowserArchive } from './browser-archive.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, 'apps/browser-extension/.output');
const { archiveBytes, archiveName } = await createBrowserArchive(repositoryRoot);

await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, archiveName), archiveBytes);
console.log(`Created deterministic Chrome Web Store archive: ${archiveName}`);
