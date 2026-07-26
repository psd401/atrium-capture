import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBrowserArchive } from './browser-archive.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(repositoryRoot, 'apps/browser-extension');
const outputRoot = path.join(extensionRoot, '.output');
const productionOAuthClientId = 'ae781263-20c0-4b0c-8a34-8be01ab72fb1';
const browserIdentity = JSON.parse(
  await readFile(path.join(repositoryRoot, 'config/browser-identity.json'), 'utf8'),
);
const extensionPackage = JSON.parse(
  await readFile(path.join(extensionRoot, 'package.json'), 'utf8'),
);
const derivedExtensionId = deriveExtensionId(browserIdentity.publicKey);
if (derivedExtensionId !== browserIdentity.extensionId) {
  throw new Error(
    `Browser public key derives ${derivedExtensionId}; expected ${browserIdentity.extensionId}.`,
  );
}
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
const rebuiltArchive = await createBrowserArchive(repositoryRoot);
if (
  rebuiltArchive.archiveName !== archiveName ||
  !rebuiltArchive.archiveBytes.equals(archiveBytes)
) {
  throw new Error('Browser archive is not reproducible from the reviewed build directory.');
}
const files = listZipEntries(archiveBytes);
const expectedIcons = {
  16: 'icons/16.png',
  32: 'icons/32.png',
  48: 'icons/48.png',
  128: 'icons/128.png',
};
const required = [
  'manifest.json',
  'managed-storage-schema.json',
  'sidepanel.html',
  ...Object.values(expectedIcons),
];
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
  manifest.key !== undefined ||
  manifest.storage?.managed_schema !== 'managed-storage-schema.json' ||
  manifest.host_permissions?.length !== 1 ||
  manifest.host_permissions[0] !== '<all_urls>'
) {
  throw new Error('Packaged manifest does not match the reviewed v1 contract.');
}
if (
  JSON.stringify(manifest.icons) !== JSON.stringify(expectedIcons) ||
  JSON.stringify(manifest.action?.default_icon) !==
    JSON.stringify({
      16: expectedIcons[16],
      32: expectedIcons[32],
    })
) {
  throw new Error('Packaged install and toolbar icons differ from the reviewed v1 set.');
}
for (const [size, iconPath] of Object.entries(expectedIcons)) {
  const icon = await readFile(path.join(outputRoot, 'chrome-mv3', iconPath));
  const dimensions = pngDimensions(icon);
  if (dimensions.width !== Number(size) || dimensions.height !== Number(size)) {
    throw new Error(`Packaged ${iconPath} is ${dimensions.width}x${dimensions.height}.`);
  }
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
  extensionId: browserIdentity.extensionId,
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

function pngDimensions(bytes) {
  const signature = '89504e470d0a1a0a';
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString('hex') !== signature ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    throw new Error('Packaged icon is not a valid PNG.');
  }
  return {
    height: bytes.readUInt32BE(20),
    width: bytes.readUInt32BE(16),
  };
}

function deriveExtensionId(publicKey) {
  const digest = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex');
  return [...digest.slice(0, 32)]
    .map((nibble) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(nibble, 16)))
    .join('');
}
