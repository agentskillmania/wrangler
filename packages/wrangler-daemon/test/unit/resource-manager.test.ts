import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ResourceManager } from '../../src/core/resource-manager.js';

describe('ResourceManager', () => {
  let tempDir: string;
  let agentsDir: string;
  let skillsDir: string;
  let crewsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-resource-test-'));
    agentsDir = join(tempDir, 'agents');
    skillsDir = join(tempDir, 'skills');
    crewsDir = join(tempDir, 'crews');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('init creates agents and skills directories', async () => {
    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    const { stat } = await import('node:fs/promises');
    const agentsStat = await stat(agentsDir);
    const skillsStat = await stat(skillsDir);
    expect(agentsStat.isDirectory()).toBe(true);
    expect(skillsStat.isDirectory()).toBe(true);
  });

  it('listAgents returns empty array when no agents', async () => {
    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    const agents = await manager.listAgents();
    expect(agents).toEqual([]);
  });

  it('listAgents discovers agents with AGENT.md', async () => {
    await mkdir(agentsDir, { recursive: true });
    await mkdir(join(agentsDir, 'test-agent'), { recursive: true });
    await writeFile(
      join(agentsDir, 'test-agent', 'AGENT.md'),
      '# Test Agent\nA helpful test agent.\n'
    );

    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    const agents = await manager.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('test-agent');
    expect(agents[0].name).toBe('test-agent');
  });

  it('listAgents skips directories without AGENT.md', async () => {
    await mkdir(agentsDir, { recursive: true });
    await mkdir(join(agentsDir, 'invalid-agent'), { recursive: true });

    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    const agents = await manager.listAgents();
    expect(agents).toEqual([]);
  });

  it('listSkills returns empty array when no skills', async () => {
    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    const skills = await manager.listSkills();
    expect(skills).toEqual([]);
  });

  it('listSkills discovers skills with SKILL.md', async () => {
    await mkdir(skillsDir, { recursive: true });
    await mkdir(join(skillsDir, 'test-skill'), { recursive: true });
    await writeFile(join(skillsDir, 'test-skill', 'SKILL.md'), '# Test Skill\nA test skill.\n');

    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    const skills = await manager.listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe('test-skill');
  });

  it('createAgent creates directory and AGENT.md', async () => {
    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    const id = await manager.createAgent({
      name: 'my-agent',
      instructions: 'You are a helpful assistant.',
    });

    expect(id).toBe('my-agent');

    const content = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(agentsDir, 'my-agent', 'AGENT.md'), 'utf-8')
    );
    expect(content).toContain('You are a helpful assistant.');
  });

  it('deleteAgent removes agent directory', async () => {
    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();
    await manager.createAgent({ name: 'to-delete', instructions: 'bye' });

    await manager.deleteAgent('to-delete');

    const agents = await manager.listAgents();
    expect(agents).toHaveLength(0);
  });

  it('createSkill creates directory and SKILL.md', async () => {
    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    const id = await manager.createSkill({ name: 'my-skill', description: 'A cool skill' });
    expect(id).toBe('my-skill');

    const content = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(skillsDir, 'my-skill', 'SKILL.md'), 'utf-8')
    );
    expect(content).toContain('my-skill');
  });

  it('deleteSkill removes skill directory', async () => {
    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();
    await manager.createSkill({ name: 'to-delete', description: 'bye' });

    await manager.deleteSkill('to-delete');

    const skills = await manager.listSkills();
    expect(skills).toHaveLength(0);
  });

  it('listAgents returns empty when agents directory does not exist', async () => {
    const manager = new ResourceManager(join(tempDir, 'nonexistent-agents'), skillsDir, crewsDir);
    // Don't call init — directory won't exist
    const agents = await manager.listAgents();
    expect(agents).toEqual([]);
  });

  it('listSkills returns empty when skills directory does not exist', async () => {
    const manager = new ResourceManager(agentsDir, join(tempDir, 'nonexistent-skills'), crewsDir);
    const skills = await manager.listSkills();
    expect(skills).toEqual([]);
  });

  it('listAgents skips non-directory entries', async () => {
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, 'not-a-dir.txt'), 'file content');

    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    const agents = await manager.listAgents();
    expect(agents).toEqual([]);
  });

  it('listSkills skips non-directory entries', async () => {
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, 'not-a-dir.txt'), 'file content');

    const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    const skills = await manager.listSkills();
    expect(skills).toEqual([]);
  });

  // ─── getAgent ───

  describe('getAgent', () => {
    it('returns null for non-existent agent', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const result = await manager.getAgent('non-existent');
      expect(result).toBeNull();
    });

    it('returns parsed agent detail for valid agent', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      await manager.createAgent({
        name: 'coder',
        instructions: 'You are a coding assistant.',
      });

      const detail = await manager.getAgent('coder');
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe('coder');
      expect(detail!.instructions).toContain('coding assistant');
      expect(detail!.path).toContain('agents/coder');
      expect(detail!.skillDirs).toEqual([]);
      expect(detail!.mcpPaths).toEqual([]);
      expect(detail!.skillCount).toBe(0);
    });

    it('parses AGENT.md frontmatter for model, description, thinking, sandbox', async () => {
      await mkdir(agentsDir, { recursive: true });
      const agentDir = join(agentsDir, 'structured-agent');
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, 'AGENT.md'),
        '---\nname: Structured\ndescription: A test agent\nmodel: gpt-4\nthinking:\n  enabled: true\nsandbox: true\n---\n\nYou are structured.',
        'utf-8'
      );

      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const detail = await manager.getAgent('structured-agent');
      expect(detail).not.toBeNull();
      expect(detail!.name).toBe('Structured');
      expect(detail!.description).toBe('A test agent');
      expect(detail!.model).toBe('gpt-4');
      expect(detail!.thinking).toEqual({ enabled: true });
      expect(detail!.sandbox).toBe(true);
    });

    it('discovers agent-private skill directories', async () => {
      await mkdir(agentsDir, { recursive: true });
      const agentDir = join(agentsDir, 'agent-with-skills');
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, 'AGENT.md'),
        '---\nname: Skilled\n---\n\nI have skills.',
        'utf-8'
      );
      const skillSubDir = join(agentDir, 'skills', 'search');
      await mkdir(skillSubDir, { recursive: true });
      await writeFile(join(skillSubDir, 'SKILL.md'), '---\nname: search\n---\n', 'utf-8');

      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const detail = await manager.getAgent('agent-with-skills');
      expect(detail!.skillCount).toBe(1);
      expect(detail!.skillDirs).toHaveLength(1);
      expect(detail!.skillDirs[0]).toContain('agent-with-skills/skills/search');
    });

    it('discovers agent mcp.json', async () => {
      await mkdir(agentsDir, { recursive: true });
      const agentDir = join(agentsDir, 'agent-mcp');
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, 'AGENT.md'), '---\nname: MCP\n---\n\nI use MCP.', 'utf-8');
      await writeFile(join(agentDir, 'mcp.json'), '{}', 'utf-8');

      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const detail = await manager.getAgent('agent-mcp');
      expect(detail!.mcpPaths).toHaveLength(1);
      expect(detail!.mcpPaths[0]).toContain('mcp.json');
    });
  });

  // ─── getSkill ───

  describe('getSkill', () => {
    it('returns null for non-existent skill', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const result = await manager.getSkill('non-existent');
      expect(result).toBeNull();
    });

    it('returns parsed skill detail with file listing', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      await manager.createSkill({
        name: 'search',
        description: 'Web search skill',
      });

      const detail = await manager.getSkill('search');
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe('search');
      expect(detail!.description).toBe('Web search skill');
      expect(detail!.path).toContain('skills/search');
      expect(detail!.files.length).toBeGreaterThanOrEqual(1);
      const skillMd = detail!.files.find((f) => f.name === 'SKILL.md');
      expect(skillMd).toBeDefined();
      expect(skillMd!.size).toBeGreaterThan(0);
    });

    it('lists implementation files in skill directory', async () => {
      await mkdir(skillsDir, { recursive: true });
      const skillDir = join(skillsDir, 'files-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: files\n---\n\nA skill.', 'utf-8');
      await writeFile(join(skillDir, 'index.ts'), 'export default {}', 'utf-8');
      await writeFile(join(skillDir, 'utils.js'), 'module.exports = {}', 'utf-8');

      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const detail = await manager.getSkill('files-skill');
      expect(detail!.files).toHaveLength(3);
      const names = detail!.files.map((f) => f.name).sort();
      expect(names).toEqual(['SKILL.md', 'index.ts', 'utils.js']);
    });

    it('excludes hidden files from file listing', async () => {
      await mkdir(skillsDir, { recursive: true });
      const skillDir = join(skillsDir, 'hidden-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: hidden\n---\n\nA skill.', 'utf-8');
      await writeFile(join(skillDir, '.hidden'), 'secret', 'utf-8');
      await writeFile(join(skillDir, 'visible.ts'), '// visible', 'utf-8');

      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const detail = await manager.getSkill('hidden-skill');
      const names = detail!.files.map((f) => f.name);
      expect(names).not.toContain('.hidden');
      expect(names).toContain('visible.ts');
    });
  });

  // ─── Crew CRUD ───

  describe('listCrews', () => {
    it('returns empty array when no crews', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const crews = await manager.listCrews();
      expect(crews).toEqual([]);
    });

    it('discovers crews with CREW.md', async () => {
      await mkdir(crewsDir, { recursive: true });
      const crewDir = join(crewsDir, 'test-crew');
      await mkdir(crewDir, { recursive: true });
      await mkdir(join(crewDir, 'agents'), { recursive: true });
      await mkdir(join(crewDir, 'skills'), { recursive: true });
      await writeFile(
        join(crewDir, 'CREW.md'),
        '---\nname: Test Crew\ndescription: A test crew\n---\n\n# Test Crew\n'
      );

      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const crews = await manager.listCrews();
      expect(crews).toHaveLength(1);
      expect(crews[0].id).toBe('test-crew');
      expect(crews[0].name).toBe('Test Crew');
      expect(crews[0].description).toBe('A test crew');
      expect(crews[0].agentCount).toBe(0);
      expect(crews[0].skillCount).toBe(0);
    });

    it('skips directories without CREW.md', async () => {
      await mkdir(crewsDir, { recursive: true });
      await mkdir(join(crewsDir, 'invalid-crew'), { recursive: true });

      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const crews = await manager.listCrews();
      expect(crews).toEqual([]);
    });

    it('counts agents and skills subdirectories', async () => {
      await mkdir(crewsDir, { recursive: true });
      const crewDir = join(crewsDir, 'full-crew');
      await mkdir(crewDir, { recursive: true });
      await mkdir(join(crewDir, 'agents'), { recursive: true });
      await mkdir(join(crewDir, 'agents', 'agent-a'), { recursive: true });
      await mkdir(join(crewDir, 'skills'), { recursive: true });
      await mkdir(join(crewDir, 'skills', 'skill-x'), { recursive: true });
      await mkdir(join(crewDir, 'skills', 'skill-y'), { recursive: true });
      await writeFile(join(crewDir, 'CREW.md'), '---\nname: Full\n---\n\n# Full\n');

      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const crews = await manager.listCrews();
      expect(crews[0].agentCount).toBe(1);
      expect(crews[0].skillCount).toBe(2);
    });

    it('returns empty when crews directory does not exist', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, join(tempDir, 'nonexistent-crews'));
      const crews = await manager.listCrews();
      expect(crews).toEqual([]);
    });
  });

  describe('getCrew', () => {
    it('returns null for non-existent crew', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const result = await manager.getCrew('non-existent');
      expect(result).toBeNull();
    });

    it('returns parsed crew detail with agents and skills', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      await manager.createCrew({
        name: 'detail-crew',
        description: 'A crew for detail test',
        primaryAgent: 'leader',
        instructions: 'Do things.',
      });

      // Add agent files manually
      await writeFile(join(crewsDir, 'detail-crew', 'agents', 'leader.md'), '# Leader\n');

      // Add skill directory with SKILL.md
      const skillDir = join(crewsDir, 'detail-crew', 'skills', 'search');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: search\n---\n');

      const detail = await manager.getCrew('detail-crew');
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe('detail-crew');
      expect(detail!.name).toBe('detail-crew');
      expect(detail!.description).toBe('A crew for detail test');
      expect(detail!.primaryAgent).toBe('leader');
      expect(detail!.crewMd).toContain('detail-crew');
      expect(detail!.agents).toHaveLength(1);
      expect(detail!.agents[0].name).toBe('leader');
      expect(detail!.agents[0].fileName).toBe('leader.md');
      expect(detail!.skills).toHaveLength(1);
      expect(detail!.skills[0].name).toBe('search');
    });

    it('returns null when id is not a directory', async () => {
      await mkdir(crewsDir, { recursive: true });
      await writeFile(join(crewsDir, 'not-a-dir.txt'), 'file content');

      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const result = await manager.getCrew('not-a-dir.txt');
      expect(result).toBeNull();
    });
  });

  describe('createCrew', () => {
    it('creates directory structure and CREW.md', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      const id = await manager.createCrew({
        name: 'new-crew',
        description: 'A new crew',
        instructions: 'Work together.',
      });

      expect(id).toBe('new-crew');

      const { stat: statFn } = await import('node:fs/promises');
      const agentsStat = await statFn(join(crewsDir, 'new-crew', 'agents'));
      const skillsStat = await statFn(join(crewsDir, 'new-crew', 'skills'));
      expect(agentsStat.isDirectory()).toBe(true);
      expect(skillsStat.isDirectory()).toBe(true);

      const content = await import('node:fs/promises').then((fs) =>
        fs.readFile(join(crewsDir, 'new-crew', 'CREW.md'), 'utf-8')
      );
      expect(content).toContain('name: new-crew');
      expect(content).toContain('description: A new crew');
      expect(content).toContain('Work together.');
    });

    it('creates CREW.md without optional fields', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();

      await manager.createCrew({ name: 'minimal-crew' });

      const content = await import('node:fs/promises').then((fs) =>
        fs.readFile(join(crewsDir, 'minimal-crew', 'CREW.md'), 'utf-8')
      );
      expect(content).toContain('name: minimal-crew');
      expect(content).not.toContain('description:');
      expect(content).not.toContain('primary-agent:');
    });
  });

  describe('deleteCrew', () => {
    it('removes crew directory', async () => {
      const manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
      await manager.init();
      await manager.createCrew({ name: 'to-delete' });

      await manager.deleteCrew('to-delete');

      const crews = await manager.listCrews();
      expect(crews).toHaveLength(0);
    });
  });
});
