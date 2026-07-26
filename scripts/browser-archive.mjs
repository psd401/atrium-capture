import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import AdmZip from 'adm-zip';

const deterministicZipTime = new Date(1980, 0, 1, 0, 0, 0);

export async function createBrowserArchive(repositoryRoot) {
  const extensionRoot = path.join(repositoryRoot, 'apps/browser-extension');
  const buildRoot = path.join(extensionRoot, '.output/chrome-mv3');
  const extensionPackage = JSON.parse(
    await readFile(path.join(extensionRoot, 'package.json'), 'utf8'),
  );
  const archiveBaseName = extensionPackage.name.replaceAll(/[@/]/g, '');
  const archiveName = `${archiveBaseName}-${extensionPackage.version}-chrome.zip`;
  const zip = new AdmZip();

  for (const relativePath of await listFiles(buildRoot)) {
    const entry = zip.addFile(
      relativePath,
      await readFile(path.join(buildRoot, relativePath)),
      '',
      0o644,
    );
    entry.header.time = deterministicZipTime;
  }

  return {
    archiveBytes: zip.toBuffer(),
    archiveName,
  };
}

async function listFiles(root, relativeDirectory = '') {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Browser build contains unsupported entry: ${relativePath}`);
    }
  }

  return files;
}
