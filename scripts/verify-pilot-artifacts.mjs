import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(repositoryRoot, 'apps/browser-extension');
const outputRoot = path.join(extensionRoot, '.output');
const uploadManifestPath = path.join(outputRoot, 'browser-upload-manifest.json');
const distributionReceiptPath =
  process.env.ATRIUM_CAPTURE_BROWSER_DISTRIBUTION_RECEIPT ??
  path.join(outputRoot, 'browser-distribution-receipt.json');
const appPath =
  process.env.ATRIUM_CAPTURE_MAC_APP_PATH ??
  path.join(repositoryRoot, 'dist/macos/Atrium Capture.app');
const distributionMode = process.argv.includes('--distribution');
const expectedExtensionId = 'jldnpmcpimhabiphcglkbgmbffpoocpo';
const expectedBundleId = 'org.psd401.AtriumCapture';

try {
  const upload = await readJson(
    uploadManifestPath,
    'Run `pnpm package:browser` before the pilot gate.',
  );
  if (
    upload.artifactKind !== 'chrome_web_store_upload' ||
    upload.signed !== false ||
    upload.distributionReady !== false
  ) {
    throw new Error('The browser upload manifest does not describe an unsigned store upload.');
  }
  if (upload.extensionId !== expectedExtensionId) {
    throw new Error(
      `Browser upload extension ID is ${upload.extensionId}; expected ${expectedExtensionId}.`,
    );
  }

  const receipt = await readJson(
    distributionReceiptPath,
    'Private Chrome Web Store signing has not been verified. Publish the exact upload bundle as PSD-only, then record the store receipt.',
  );
  if (
    receipt.schemaVersion !== 1 ||
    receipt.signed !== true ||
    receipt.distribution !== 'chrome_web_store_private' ||
    receipt.visibility !== 'psd_only' ||
    receipt.status !== 'published'
  ) {
    throw new Error(
      'Browser distribution receipt must prove a published, signed, private PSD-only Chrome Web Store item.',
    );
  }
  if (
    receipt.extensionId !== upload.extensionId ||
    receipt.version !== upload.version ||
    receipt.uploadSha256 !== upload.sha256
  ) {
    throw new Error(
      'Browser distribution receipt does not match the exact verified upload bundle.',
    );
  }

  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const signature = run('codesign', ['-dvvv', appPath], true);
  const identifier = extract(signature, /^Identifier=(.+)$/m, 'bundle identifier');
  const teamIdentifier = extract(signature, /^TeamIdentifier=(.+)$/m, 'signing team');
  const authority = extract(signature, /^Authority=(.+)$/m, 'signing authority');
  if (identifier !== expectedBundleId) {
    throw new Error(`Mac bundle ID is ${identifier}; expected ${expectedBundleId}.`);
  }
  if (teamIdentifier === 'not set' || authority === '(unavailable)') {
    throw new Error('Mac app is ad-hoc signed; a stable Apple signing identity is required.');
  }
  if (!/^(?:Apple Development|Developer ID Application):/.test(authority)) {
    throw new Error(`Mac signing authority is not approved for pilot use: ${authority}`);
  }

  let macDistribution = 'apple_development_pilot';
  if (authority.startsWith('Developer ID Application:')) {
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
    macDistribution = 'developer_id_gatekeeper_accepted';
  } else if (distributionMode) {
    throw new Error(
      'District distribution requires a Developer ID Application signature accepted by Gatekeeper; Apple Development is pilot-only.',
    );
  }

  console.log(
    JSON.stringify({
      browser: {
        distribution: receipt.distribution,
        extensionId: receipt.extensionId,
        signed: true,
        uploadSha256: receipt.uploadSha256,
        version: receipt.version,
        visibility: receipt.visibility,
      },
      mac: {
        bundleId: identifier,
        distribution: macDistribution,
        signingAuthority: authority,
        teamIdentifier,
      },
      mode: distributionMode ? 'distribution' : 'pilot',
      status: 'pass',
    }),
  );
} catch (error) {
  console.error(`pilot-artifact-verifier: ${error.message}`);
  process.exitCode = 1;
}

async function readJson(filePath, missingMessage) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${missingMessage} Missing: ${filePath}`, { cause: error });
    }
    throw error;
  }
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${output.trim()}`);
  }
  if (!capture && output.trim()) {
    process.stderr.write(output);
  }
  return output;
}

function extract(value, pattern, label) {
  const match = value.match(pattern);
  if (!match) {
    throw new Error(`Could not read Mac ${label} from code signature.`);
  }
  return match[1].trim();
}
