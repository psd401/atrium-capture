import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
const expectedTeamId = '87DL7L9GU6';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed.\n${output}`);
  }
  return output;
}

function extract(output, pattern, description) {
  const match = output.match(pattern);
  assert(match, `Packaged app signature is missing ${description}.`);
  return match[1].trim();
}

assert(manifest.schemaVersion === 1, 'Unsupported Mac package manifest schema.');
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'Invalid Mac package version.');
assert(
  manifest.artifact === `Atrium-Capture-${manifest.version}.pkg`,
  'Package artifact name does not match its version.',
);
assert(manifest.packageIdentifier === 'org.psd401.AtriumCapture.pkg', 'Wrong package ID.');
assert(manifest.bundleIdentifier === 'org.psd401.AtriumCapture', 'Wrong bundle ID.');
assert(manifest.installLocation === '/', 'Wrong package install location.');
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

const inspectionRoot = await mkdtemp(path.join(tmpdir(), 'atrium-capture-package-verify.'));
try {
  const expandedPath = path.join(inspectionRoot, 'expanded');
  const payloadRoot = path.join(inspectionRoot, 'payload');
  execFileSync('pkgutil', ['--expand', artifactPath, expandedPath], { stdio: 'pipe' });

  const distribution = await readFile(path.join(expandedPath, 'Distribution'), 'utf8');
  const packageInfo = await readFile(
    path.join(expandedPath, 'AtriumCapture-component.pkg', 'PackageInfo'),
    'utf8',
  );
  const domains = distribution.match(/<domains\b[^>]*\/?\s*>/)?.[0] ?? '';
  assert(domains.includes('enable_anywhere="false"'), 'Mac package allows other volumes.');
  assert(
    domains.includes('enable_currentUserHome="false"'),
    'Mac package allows installation into a user home directory.',
  );
  assert(
    domains.includes('enable_localSystem="true"'),
    'Mac package disallows system installation.',
  );
  assert(
    /<must-close>[\s\S]*?<app\s+id="org\.psd401\.AtriumCapture"\s*\/>[\s\S]*?<\/must-close>/.test(
      distribution,
    ),
    'Mac package does not require Atrium Capture to quit before replacement.',
  );

  const packageMetadata = packageInfo.match(/<pkg-info\b[^>]*>/)?.[0] ?? '';
  assert(
    packageMetadata.includes('identifier="org.psd401.AtriumCapture.pkg"'),
    'Mac component package has the wrong identifier.',
  );
  assert(
    packageMetadata.includes('install-location="/"'),
    'Mac component package has the wrong install location.',
  );
  assert(packageMetadata.includes('auth="root"'), 'Mac component package does not require root.');
  const relocationRules = packageInfo.match(/<relocate\b[^>]*>([\s\S]*?)<\/relocate>/)?.[1] ?? '';
  assert(
    !/<bundle\b/.test(relocationRules),
    'Mac component package may relocate an existing app outside /Applications.',
  );

  await mkdir(payloadRoot);
  execFileSync(
    'tar',
    ['-xzf', path.join(expandedPath, 'AtriumCapture-component.pkg', 'Payload'), '-C', payloadRoot],
    { stdio: 'pipe' },
  );
  const packagedAppPath = path.join(payloadRoot, 'Applications', 'Atrium Capture.app');
  const packagedInfoPath = path.join(packagedAppPath, 'Contents', 'Info.plist');
  const nativeHostManifest = JSON.parse(
    await readFile(
      path.join(
        payloadRoot,
        'Library',
        'Google',
        'Chrome',
        'NativeMessagingHosts',
        'org.psd401.atrium_capture.json',
      ),
      'utf8',
    ),
  );
  assert(
    nativeHostManifest.path ===
      '/Applications/Atrium Capture.app/Contents/Helpers/AtriumCaptureNativeHost',
    'Packaged native host points at the wrong app copy.',
  );
  assert(
    Array.isArray(nativeHostManifest.allowed_origins) &&
      nativeHostManifest.allowed_origins.length === 1 &&
      nativeHostManifest.allowed_origins[0] ===
        'chrome-extension://eomlblaiglafndhplfhilmdcaofhkkbj/',
    'Packaged native host has the wrong extension allowlist.',
  );
  const plistValue = (key) =>
    execFileSync('plutil', ['-extract', key, 'raw', packagedInfoPath], {
      encoding: 'utf8',
    }).trim();

  assert(
    plistValue('CFBundleIdentifier') === manifest.bundleIdentifier,
    'Packaged bundle ID mismatch.',
  );
  assert(
    plistValue('CFBundleShortVersionString') === manifest.version,
    'Packaged app version mismatch.',
  );
  assert(plistValue('CFBundleVersion') === manifest.buildNumber, 'Packaged app build mismatch.');

  const packagedArchitectures = run('lipo', [
    '-archs',
    path.join(packagedAppPath, 'Contents', 'MacOS', 'AtriumCaptureMacApp'),
  ]);
  for (const architecture of manifest.architectures) {
    assert(
      packagedArchitectures.split(/\s+/).includes(architecture),
      `Packaged app is missing the ${architecture} architecture.`,
    );
  }

  run('codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--all-architectures',
    '--verbose=2',
    packagedAppPath,
  ]);
  const appSignature = run('codesign', ['-dvvv', '--requirements', '-', packagedAppPath]);
  const signatureIdentifier = extract(appSignature, /^Identifier=(.+)$/m, 'bundle identifier');
  const signatureTeamId = extract(appSignature, /^TeamIdentifier=(.+)$/m, 'team identifier');
  const signatureAuthority = extract(appSignature, /^Authority=(.+)$/m, 'signing authority');
  assert(
    signatureIdentifier === manifest.bundleIdentifier,
    'Packaged app signature has the wrong bundle identifier.',
  );
  assert(
    signatureTeamId !== 'not set' && signatureTeamId === manifest.teamId,
    'Packaged app signature does not match the manifest signing team.',
  );
  assert(
    /^(?:Apple Development|Developer ID Application):/.test(signatureAuthority),
    'Packaged app does not have an approved stable Apple signing authority.',
  );

  if (manifest.distributionReady) {
    assert(manifest.teamId === expectedTeamId, 'Manifest has the wrong Mac signing team.');
    assert(
      signatureTeamId === expectedTeamId,
      'Packaged app signature has the wrong signing team.',
    );
    assert(
      signatureAuthority.startsWith('Developer ID Application:'),
      'Packaged app signature authority is not Developer ID Application.',
    );
    run('xcrun', ['stapler', 'validate', packagedAppPath]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', packagedAppPath]);
  }
} finally {
  await rm(inspectionRoot, { recursive: true, force: true });
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
  assert(manifest.teamId === expectedTeamId, 'Distribution package has the wrong signing team.');
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
