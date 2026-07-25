import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(repositoryRoot, 'apps/browser-extension');
const outputRoot = path.join(extensionRoot, '.output');
const productionOAuthClientId = 'ae781263-20c0-4b0c-8a34-8be01ab72fb1';
const extensionPackage = JSON.parse(
  await readFile(path.join(extensionRoot, 'package.json'), 'utf8'),
);
const archiveCandidates = (await readdir(outputRoot)).filter(
  (name) => name.endsWith('-chrome.zip') && name.includes(extensionPackage.version),
);
if (archiveCandidates.length !== 1) {
  throw new Error(
    `Expected one Chrome ${extensionPackage.version} archive; found ${archiveCandidates.length}.`,
  );
}

const archiveName = archiveCandidates[0];
const archiveBytes = await readFile(path.join(outputRoot, archiveName));
const files = listZipEntries(archiveBytes);
const required = ['manifest.json', 'managed-storage-schema.json', 'sidepanel.html'];
for (const name of required) {
  if (!files.includes(name)) {
    throw new Error(`Browser archive is missing ${name}.`);
  }
}
if (!files.some((name) => name === 'background.js')) {
  throw new Error('Browser archive is missing its service worker.');
}
if (!files.some((name) => name.startsWith('content-scripts/') && name.endsWith('.js'))) {
  throw new Error('Browser archive is missing its content script.');
}
const prohibited = files.filter((name) =>
  /(^|\/)(?:test|tests|fixtures|node_modules)(?:\/|$)|\.(?:map|pem|key|ts|tsx)$|(?:^|\/)\.env/i.test(
    name,
  ),
);
if (prohibited.length > 0) {
  throw new Error(
    `Browser archive contains prohibited development files: ${prohibited.join(', ')}`,
  );
}

const manifest = JSON.parse(
  await readFile(path.join(outputRoot, 'chrome-mv3/manifest.json'), 'utf8'),
);
if (
  manifest.manifest_version !== 3 ||
  manifest.version !== extensionPackage.version ||
  manifest.storage?.managed_schema !== 'managed-storage-schema.json' ||
  manifest.host_permissions?.length !== 1 ||
  manifest.host_permissions[0] !== '<all_urls>'
) {
  throw new Error('Packaged manifest does not match the reviewed v1 contract.');
}
const expectedPermissions = ['identity', 'sidePanel', 'storage', 'unlimitedStorage'];
if (
  !Array.isArray(manifest.permissions) ||
  JSON.stringify([...manifest.permissions].sort()) !==
    JSON.stringify([...expectedPermissions].sort())
) {
  throw new Error('Packaged permissions differ from the reviewed v1 allowlist.');
}
if (
  !Array.isArray(manifest.optional_permissions) ||
  JSON.stringify([...manifest.optional_permissions].sort()) !== JSON.stringify(['nativeMessaging'])
) {
  throw new Error('Packaged optional permissions differ from the reviewed Mac bridge allowlist.');
}
const background = await readFile(path.join(outputRoot, 'chrome-mv3/background.js'), 'utf8');
if (!background.includes(productionOAuthClientId)) {
  throw new Error('Packaged worker is missing the approved production OAuth public client ID.');
}

const releaseManifest = {
  artifact: archiveName,
  artifactKind: 'chrome_web_store_upload',
  bytes: archiveBytes.byteLength,
  distributionReady: false,
  extensionId: 'jldnpmcpimhabiphcglkbgmbffpoocpo',
  files: files.length,
  manifestVersion: 3,
  privacy: {
    liveAtriumConfiguration: 'bundled-public-client',
    telemetryEnabled: false,
  },
  schemaVersion: 1,
  sha256: createHash('sha256').update(archiveBytes).digest('hex'),
  signed: false,
  version: extensionPackage.version,
};
await writeFile(
  path.join(outputRoot, 'browser-upload-manifest.json'),
  `${JSON.stringify(releaseManifest, undefined, 2)}\n`,
);
console.log(JSON.stringify(releaseManifest));

function listZipEntries(bytes) {
  const endSignature = 0x06054b50;
  let endOffset = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (bytes.readUInt32LE(index) === endSignature) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) {
    throw new Error('Browser artifact is not a valid ZIP archive.');
  }
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  let offset = bytes.readUInt32LE(endOffset + 16);
  const names = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Browser artifact central directory is invalid.');
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names.sort();
}
