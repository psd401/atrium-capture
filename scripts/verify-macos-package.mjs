import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.resolve(
  process.argv[2] ?? path.join(repositoryRoot, 'dist/macos/macos-package-manifest.json'),
);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const artifactPath = path.join(path.dirname(manifestPath), manifest.artifact);
const artifact = await readFile(artifactPath);
const artifactStat = await stat(artifactPath);
const digest = createHash('sha256').update(artifact).digest('hex');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(manifest.schemaVersion === 1, 'Unsupported Mac package manifest schema.');
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'Invalid Mac package version.');
assert(
  manifest.artifact === `Atrium-Capture-${manifest.version}.pkg`,
  'Package artifact name does not match its version.',
);
assert(manifest.packageIdentifier === 'org.psd401.AtriumCapture.pkg', 'Wrong package ID.');
assert(manifest.bundleIdentifier === 'org.psd401.AtriumCapture', 'Wrong bundle ID.');
assert(manifest.appPath === '/Applications/Atrium Capture.app', 'Wrong app install path.');
assert(
  Array.isArray(manifest.architectures) &&
    manifest.architectures.length === 2 &&
    manifest.architectures.includes('arm64') &&
    manifest.architectures.includes('x86_64'),
  'Mac package must support Apple silicon and Intel.',
);
assert(
  manifest.nativeMessagingManifest ===
    '/Library/Google/Chrome/NativeMessagingHosts/org.psd401.atrium_capture.json',
  'Wrong native messaging manifest path.',
);
assert(digest === manifest.sha256, 'Mac package SHA-256 mismatch.');
assert(artifactStat.size === manifest.bytes, 'Mac package byte count mismatch.');

const payload = execFileSync('pkgutil', ['--payload-files', artifactPath], {
  encoding: 'utf8',
});
const payloadEntries = payload
  .split('\n')
  .filter(Boolean)
  .map((entry) => entry.replace(/^\.\//, ''));
for (const requiredPath of [
  'Applications/Atrium Capture.app/Contents/Info.plist',
  'Applications/Atrium Capture.app/Contents/MacOS/AtriumCaptureMacApp',
  'Applications/Atrium Capture.app/Contents/Helpers/AtriumCaptureNativeHost',
  'Library/Google/Chrome/NativeMessagingHosts/org.psd401.atrium_capture.json',
]) {
  assert(payloadEntries.includes(requiredPath), `Mac package is missing ${requiredPath}.`);
}

if (manifest.distributionReady) {
  assert(
    manifest.appSignature === 'developer_id_application',
    'Distribution package lacks Developer ID Application signing.',
  );
  assert(
    manifest.installerSignature === 'developer_id_installer',
    'Distribution package lacks Developer ID Installer signing.',
  );
  assert(manifest.notarized, 'Distribution package is not notarized.');
  assert(manifest.stapled, 'Distribution package lacks a stapled notarization ticket.');
  assert(manifest.gatekeeperAccepted, 'Gatekeeper did not accept the distribution package.');
  const signature = execFileSync('pkgutil', ['--check-signature', artifactPath], {
    encoding: 'utf8',
    stderr: 'pipe',
  });
  assert(
    signature.includes('Developer ID Installer:'),
    'Distribution package signature authority is not Developer ID Installer.',
  );
  execFileSync('xcrun', ['stapler', 'validate', artifactPath], { stdio: 'pipe' });
  execFileSync('spctl', ['--assess', '--type', 'install', '--verbose=2', artifactPath], {
    stdio: 'pipe',
  });
}

console.log(
  `macos-package-verifier: ${manifest.artifact} ${manifest.sha256} ` +
    `distributionReady=${String(manifest.distributionReady)}`,
);
