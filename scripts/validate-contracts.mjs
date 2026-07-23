import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaFixtures = [
  [
    'contracts/capture-session.schema.json',
    'packages/test-fixtures/fixtures/capture-session-v1.json',
  ],
  ['contracts/native-bridge.schema.json', 'packages/test-fixtures/fixtures/native-bridge-v1.json'],
  ['contracts/publish-job.schema.json', 'packages/test-fixtures/fixtures/publish-job-v1.json'],
  [
    'contracts/publish-job.schema.json',
    'packages/test-fixtures/fixtures/publish-job-ready-v1.json',
  ],
];

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validators = new Map();

for (const [schemaPath, fixturePath] of schemaFixtures) {
  const fixture = JSON.parse(await readFile(path.join(repositoryRoot, fixturePath), 'utf8'));
  let validate = validators.get(schemaPath);
  if (!validate) {
    const schema = JSON.parse(await readFile(path.join(repositoryRoot, schemaPath), 'utf8'));
    validate = ajv.compile(schema);
    validators.set(schemaPath, validate);
  }

  if (!validate(fixture)) {
    throw new Error(`${fixturePath} failed ${schemaPath}: ${ajv.errorsText(validate.errors)}`);
  }
}

console.log(`Validated ${schemaFixtures.length} shared contract fixtures.`);
