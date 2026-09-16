/**
 * run_skill_script — failure self-heal + guard wording.
 * Wrong script paths must fail with the skill's ACTUAL script inventory
 * attached (one-shot self-correction), traversal/absolute paths are
 * rejected up front, and the description/parameters carry the
 * "use inventory paths, do not guess" guard. (R2P-114w, aligned with
 * Rust c78cfcc.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ZodObject, ZodRawShape } from 'zod';

import { createRunScriptTool } from '../../../../src/tools/skill/run-script.js';
import type { ISkillProvider } from '@agentskillmania/colts';
import { createMockToolDeps } from '../../helpers/create-mock-deps.js';

function makeProvider(manifest: Record<string, unknown> | null, source: string): ISkillProvider {
  return {
    getManifest: vi.fn().mockResolvedValue(manifest),
    loadInstructions: vi.fn().mockResolvedValue('body'),
    loadResource: vi.fn(),
    listSkills: vi.fn().mockResolvedValue([{ name: 'demo', description: 'Demo', source }]),
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as ISkillProvider;
}

describe('createRunScriptTool', () => {
  let skillDir: string;

  beforeEach(async () => {
    skillDir = join(
      tmpdir(),
      `wrangler-test-runscript-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(join(skillDir, 'scripts'), { recursive: true });
    await writeFile(join(skillDir, 'scripts', 'run.js'), 'console.log("ok");');
  });

  afterEach(async () => {
    await rm(skillDir, { recursive: true, force: true }).catch(() => {});
  });

  function manifest(extra: Record<string, unknown> = {}) {
    return {
      name: 'demo',
      description: 'Demo',
      source: skillDir,
      resources: ['reference/catalog.md'],
      scripts: ['scripts/run.js'],
      ...extra,
    };
  }

  it('has the inventory guard wording in its description and parameter', () => {
    const tool = createRunScriptTool(createMockToolDeps(), makeProvider(null, skillDir));
    expect(tool.description).toContain(
      'must be one of the scripts listed when the skill was loaded'
    );
    expect(tool.description).toContain('do not guess paths');
    const schema = tool.parameters as unknown as ZodObject<ZodRawShape>;
    expect(String(schema.shape.script_path?.description)).toContain(
      "skill's inventory (returned by load_skill)"
    );
    expect(String(schema.shape.script_path?.description)).toContain('Do not guess');
  });

  it('rejects absolute script paths', async () => {
    const tool = createRunScriptTool(createMockToolDeps(), makeProvider(manifest(), skillDir));
    const result = await tool.execute({
      skill_name: 'demo',
      script_path: '/etc/passwd',
      command: 'node',
    });
    expect(result).toContain('Invalid script path');
    expect(result).toContain('must be a relative path inside the skill directory');
  });

  it('rejects parent-directory traversal in the script path', async () => {
    const tool = createRunScriptTool(createMockToolDeps(), makeProvider(manifest(), skillDir));
    const result = await tool.execute({
      skill_name: 'demo',
      script_path: '../outside.sh',
      command: 'bash',
    });
    expect(result).toContain('Invalid script path');
  });

  it('attaches the actual script inventory when the script is missing (self-heal)', async () => {
    const tool = createRunScriptTool(createMockToolDeps(), makeProvider(manifest(), skillDir));
    const result = await tool.execute({
      skill_name: 'demo',
      script_path: 'scripts/gone.py',
      command: 'python3',
    });
    expect(result).toContain('Script not found:');
    expect(result).toContain(join(skillDir, 'scripts/gone.py'));
    expect(result).toContain("Scripts in skill 'demo': scripts/run.js");
  });

  it('reports the plain not-found message when the skill has no scripts', async () => {
    const tool = createRunScriptTool(
      createMockToolDeps(),
      makeProvider(manifest({ scripts: undefined }), skillDir)
    );
    const result = await tool.execute({
      skill_name: 'demo',
      script_path: 'scripts/gone.py',
      command: 'python3',
    });
    expect(result).toContain('Script not found:');
    expect(result).not.toContain('Scripts in skill');
  });

  it('lists available skills when the skill is unknown', async () => {
    const tool = createRunScriptTool(createMockToolDeps(), makeProvider(null, skillDir));
    const result = await tool.execute({
      skill_name: 'nope',
      script_path: 'scripts/run.js',
      command: 'node',
    });
    expect(result).toBe("Skill 'nope' not found. Available: demo");
  });

  it('executes the resolved absolute script with the chosen interpreter', async () => {
    const execArray = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });
    const tool = createRunScriptTool(
      createMockToolDeps({ execArray } as never),
      makeProvider(manifest(), skillDir)
    );
    const result = await tool.execute({
      skill_name: 'demo',
      script_path: 'scripts/run.js',
      command: 'node',
      args: ['--flag', 'value'],
    });
    expect(result).toBe('ok');
    expect(execArray).toHaveBeenCalledWith('node', [
      join(skillDir, 'scripts/run.js'),
      '--flag',
      'value',
    ]);
  });

  it('formats non-zero exits with stdout/stderr sections', async () => {
    const execArray = vi.fn().mockResolvedValue({ stdout: 'out', stderr: 'err', exitCode: 2 });
    const tool = createRunScriptTool(
      createMockToolDeps({ execArray } as never),
      makeProvider(manifest(), skillDir)
    );
    const result = await tool.execute({
      skill_name: 'demo',
      script_path: 'scripts/run.js',
      command: 'node',
    });
    expect(result).toBe('Exit code: 2\nSTDOUT:\nout\nSTDERR:\nerr');
  });

  it('returns (no output) for silent success', async () => {
    const execArray = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const tool = createRunScriptTool(
      createMockToolDeps({ execArray } as never),
      makeProvider(manifest(), skillDir)
    );
    const result = await tool.execute({
      skill_name: 'demo',
      script_path: 'scripts/run.js',
      command: 'node',
    });
    expect(result).toBe('(no output)');
  });
});
