import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
const requestedBuild = process.argv[3];

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  throw new Error('Usage: pnpm release:prepare <major.minor.patch> [build-number]');
}

const packagePaths = [
  path.join(repositoryRoot, 'package.json'),
  path.join(repositoryRoot, 'apps/browser-extension/package.json'),
];
for (const packagePath of packagePaths) {
  const packageDocument = JSON.parse(await readFile(packagePath, 'utf8'));
  packageDocument.version = version;
  await writeFile(packagePath, `${JSON.stringify(packageDocument, null, 2)}\n`);
}

const plistPath = path.join(repositoryRoot, 'apps/macos/App/Info.plist');
let plist = await readFile(plistPath, 'utf8');
const currentBuildMatch = plist.match(/<key>CFBundleVersion<\/key>\s*<string>(\d+)<\/string>/);
if (!currentBuildMatch) throw new Error('CFBundleVersion is missing or invalid.');
const buildNumber = requestedBuild ?? String(Number(currentBuildMatch[1]) + 1);
if (!/^[1-9]\d*$/.test(buildNumber)) {
  throw new Error('Build number must be a positive integer.');
}

function replacePlistString(key, value) {
  const expression = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]+(</string>)`);
  if (!expression.test(plist)) throw new Error(`${key} is missing from Info.plist.`);
  plist = plist.replace(expression, `$1${value}$2`);
}

replacePlistString('CFBundleShortVersionString', version);
replacePlistString('CFBundleVersion', buildNumber);
await writeFile(plistPath, plist);

console.log(`Prepared Atrium Capture ${version} (build ${buildNumber}).`);
