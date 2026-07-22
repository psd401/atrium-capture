import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import prettier from 'prettier';
import { FetchingJSONSchemaStore, InputData, JSONSchemaInput, quicktype } from 'quicktype-core';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const sources = [
  ['CaptureSession', 'contracts/capture-session.schema.json'],
  ['NativeBridgeMessage', 'contracts/native-bridge.schema.json'],
  ['PublishJob', 'contracts/publish-job.schema.json'],
];

async function render(language, rendererOptions) {
  const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());

  for (const [name, relativePath] of sources) {
    const schema = await readFile(path.join(repositoryRoot, relativePath), 'utf8');
    await schemaInput.addSource({ name, schema });
  }

  const inputData = new InputData();
  inputData.addInput(schemaInput);
  const result = await quicktype({
    inputData,
    lang: language,
    rendererOptions,
  });

  return `${result.lines.join('\n')}\n`;
}

async function emit(relativePath, contents) {
  const destination = path.join(repositoryRoot, relativePath);

  if (checkOnly) {
    let existing;
    try {
      existing = await readFile(destination, 'utf8');
    } catch {
      throw new Error(`Generated contract is missing: ${relativePath}`);
    }

    if (existing !== contents) {
      throw new Error(`Generated contract is stale: ${relativePath}`);
    }
    return;
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents, 'utf8');
}

const typescriptBody = await render('typescript', {
  'just-types': 'true',
  'prefer-unions': 'false',
});
const prettierConfig =
  (await prettier.resolveConfig(
    path.join(repositoryRoot, 'packages/contracts/src/generated/contracts.ts'),
  )) ?? {};
const typescriptContents = await prettier.format(
  `// Generated from contracts/*.schema.json. Do not edit by hand.\n\n${typescriptBody}`,
  { ...prettierConfig, parser: 'typescript' },
);

const swiftBody = await render('swift', {
  'access-level': 'public',
  'struct-or-class': 'struct',
});
// CodingKey refines Sendable in Swift 6; quicktype 26 emits this helper as a
// non-final class, which the compiler correctly rejects under Swift 6 mode.
let swift6Body = swiftBody.replace(
  '\nclass JSONCodingKey: CodingKey {',
  '\nfinal class JSONCodingKey: CodingKey {',
);
swift6Body = swift6Body
  .replace(
    /func newJSONDecoder\(\) -> JSONDecoder \{[\s\S]*?\n\}/,
    'func newJSONDecoder() -> JSONDecoder {\n    AtriumContractCodec.makeDecoder()\n}',
  )
  .replace(
    /func newJSONEncoder\(\) -> JSONEncoder \{[\s\S]*?\n\}/,
    'func newJSONEncoder() -> JSONEncoder {\n    AtriumContractCodec.makeEncoder()\n}',
  );
const swiftContents = `// Generated from contracts/*.schema.json. Do not edit by hand.\n\n${swift6Body.trimEnd()}\n`;

await emit('packages/contracts/src/generated/contracts.ts', typescriptContents);
await emit('apps/macos/Sources/AtriumCaptureContracts/Generated/Contracts.swift', swiftContents);

console.log(
  checkOnly ? 'Generated contracts are current.' : 'Generated TypeScript and Swift contracts.',
);
