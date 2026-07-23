import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostPath = process.argv[2];
if (!hostPath) {
  throw new Error('Usage: node scripts/verify-native-host.mjs /absolute/path/to/host');
}

function frame(body) {
  const json = Buffer.from(JSON.stringify(body));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length);
  return Buffer.concat([header, json]);
}

function exchange(body) {
  const result = spawnSync(hostPath, { input: frame(body), maxBuffer: 128 * 1024 });
  if (result.status !== 0) {
    throw new Error(`Native host exited with ${String(result.status)}.`);
  }
  if (result.stdout.length < 4) throw new Error('Native host returned no framed response.');
  const length = result.stdout.readUInt32LE(0);
  if (length !== result.stdout.length - 4) throw new Error('Native host response length mismatch.');
  return JSON.parse(result.stdout.subarray(4).toString('utf8'));
}

const fixture = JSON.parse(
  await readFile(
    path.join(repositoryRoot, 'packages/test-fixtures/fixtures/native-bridge-v1.json'),
    'utf8',
  ),
);
const accepted = exchange(fixture);
if (accepted.type !== 'session_state' || accepted.payload.code !== 'ACCEPTED_METADATA_ONLY') {
  throw new Error('Metadata fixture was not acknowledged by the native host.');
}

const rejected = exchange({
  ...fixture,
  messageId: '40000000-0000-4000-8000-000000000099',
  payload: { imageData: 'synthetic-prohibited-bytes' },
});
if (rejected.type !== 'error' || rejected.payload.code !== 'INVALID_MESSAGE') {
  throw new Error('Native host did not reject screenshot bytes.');
}

console.log('native-host-verifier: metadata accepted and screenshot bytes rejected');
