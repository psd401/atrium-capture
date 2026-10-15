// ABOUTME: Tests that the committed Atrium assistant definition imports cleanly and that the
// ABOUTME: sample reply in its companion doc validates against the guide-suggestion contract.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const definitionPath = path.resolve(
  import.meta.dirname,
  '../../../docs/atrium/capture-guide-writer.assistant.json',
);
const promptDocPath = path.resolve(
  import.meta.dirname,
  '../../../docs/atrium/capture-guide-writer.md',
);
const fixturePath = path.resolve(
  import.meta.dirname,
  '../../../packages/test-fixtures/fixtures/guide-suggestion-v1.json',
);

describe('Capture Guide Writer assistant definition', () => {
  it('is a version 1.0 Atrium export with one text input named steps', async () => {
    const definition = JSON.parse(await readFile(definitionPath, 'utf8')) as {
      assistants: Array<{
        input_fields: Array<{ field_type: string; name: string }>;
        name: string;
        prompts: Array<{ content: string; model_name: string }>;
      }>;
      version: string;
    };
    expect(definition.version).toBe('1.0');
    expect(definition.assistants).toHaveLength(1);
    const assistant = definition.assistants[0]!;
    expect(assistant.name).toBe('Capture Guide Writer');
    expect(assistant.input_fields).toEqual([
      expect.objectContaining({ field_type: 'long_text', name: 'steps' }),
    ]);
    expect(assistant.prompts).toHaveLength(1);
    const prompt = assistant.prompts[0]!.content;
    expect(prompt).toContain('${steps}');
    expect(prompt).toContain('"schemaVersion": 1');
    expect(prompt).toContain('Return only JSON');
    expect(prompt).toContain('never receive screenshots');
    expect(prompt).not.toMatch(/attached image|look at the (screenshot|image)|image input/i);
  });
});

describe('Capture Guide Writer prompt doc', () => {
  it('holds the same prompt text as the assistant definition', async () => {
    const definition = JSON.parse(await readFile(definitionPath, 'utf8')) as {
      assistants: Array<{ prompts: Array<{ content: string }> }>;
    };
    const promptDoc = await readFile(promptDocPath, 'utf8');
    const promptContent = definition.assistants[0]!.prompts[0]!.content;
    for (const line of promptContent.split('\n')) {
      expect(promptDoc).toContain(line);
    }
  });

  it('embeds the contract fixture as its sample reply', async () => {
    // scripts/validate-contracts.mjs validates this fixture against the schema with ajv,
    // so equality here proves the documented sample is schema-valid.
    const promptDoc = await readFile(promptDocPath, 'utf8');
    const fenced = [...promptDoc.matchAll(/```json\n([\s\S]*?)\n```/g)];
    expect(fenced.length).toBeGreaterThan(0);
    const sampleReply = JSON.parse(fenced.at(-1)![1]!) as unknown;
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
    expect(sampleReply).toEqual(fixture);
  });
});
