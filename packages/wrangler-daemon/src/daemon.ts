import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConfigManager } from './core/config-manager.js';
import { ResourceManager } from './core/resource-manager.js';
import { SessionManager } from './core/session-manager.js';
import { healthRoutes } from './routes/health.js';
import { configRoutes } from './routes/config.js';
import { agentRoutes } from './routes/agents.js';
import { skillRoutes } from './routes/skills.js';
import { sessionRoutes } from './routes/sessions.js';
import { launcherRoutes } from './routes/launcher.js';
import { chatRoutes } from './routes/chat.js';
import { fileRoutes } from './routes/files.js';
import { agentStateRoutes } from './routes/agent-state.js';
import { skillFileRoutes } from './routes/skill-files.js';
import { agentFileRoutes } from './routes/agent-files.js';
import { crewRoutes } from './routes/crews.js';
import { crewFileRoutes } from './routes/crew-files.js';
import { devtoolRoutes } from './routes/devtool.js';
import { devtoolStreamRoutes } from './routes/devtool-stream.js';
import { specRoutes } from './routes/specs.js';
import { planRoutes } from './routes/plans.js';
import { modelRoutes } from './routes/models.js';
import { CONFIG_PATH, AGENTS_DIR, SKILLS_DIR, SESSIONS_DIR, CREWS_DIR } from './constants.js';
import type { DaemonOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Top-level daemon class coordinating all subsystems.
 *
 * Holds a Fastify instance and four core managers. The only public
 * lifecycle methods are `startup()` and `shutdown()`.
 */
export class Daemon {
  private fastify: FastifyInstance;
  private configManager: ConfigManager;
  private resourceManager: ResourceManager;
  private sessionManager: SessionManager;
  private readonly options: Required<DaemonOptions>;

  constructor(options: DaemonOptions = {}) {
    this.options = {
      port: options.port ?? 3100,
      host: options.host ?? 'localhost',
    };

    this.fastify = Fastify({ logger: false });
    this.configManager = new ConfigManager(CONFIG_PATH);
    this.resourceManager = new ResourceManager(AGENTS_DIR, SKILLS_DIR, CREWS_DIR);
    this.sessionManager = new SessionManager(SESSIONS_DIR);
  }

  /** Initialize managers and start HTTP server */
  async startup(): Promise<void> {
    // 1. Config
    await this.configManager.init();

    // 2. Resources
    await this.resourceManager.init();

    // 3. Sessions — discover existing sessions from disk
    await this.sessionManager.init();

    // 4. Register routes
    // Serve playground static files (HTML, CSS, JS)
    const staticDir = [join(__dirname, 'static'), join(__dirname, '..', 'src', 'static')];
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
    };

    const serveStatic = async (filename: string, reply: FastifyReply) => {
      for (const dir of staticDir) {
        try {
          const content = await readFile(join(dir, filename), 'utf-8');
          const ext = filename.substring(filename.lastIndexOf('.'));
          reply.type(mimeTypes[ext] || 'application/octet-stream').send(content);
          return true;
        } catch {
          /* next candidate */
        }
      }
      return false;
    };

    this.fastify.get('/', async (_request, reply) => {
      if (!(await serveStatic('playground.html', reply))) {
        reply.code(404).send({ error: 'Playground page not found' });
      }
    });

    this.fastify.get('/playground', async (_request, reply) => {
      if (!(await serveStatic('playground.html', reply))) {
        reply.code(404).send({ error: 'Playground page not found' });
      }
    });

    this.fastify.get('/playground.css', async (_request, reply) => {
      if (!(await serveStatic('playground.css', reply))) {
        reply.code(404).send({ error: 'CSS not found' });
      }
    });

    this.fastify.get('/playground.js', async (_request, reply) => {
      if (!(await serveStatic('playground.js', reply))) {
        reply.code(404).send({ error: 'JS not found' });
      }
    });

    // Serve vendor static files (third-party libs: preact, htm, codemirror, json-formatter)
    this.fastify.get('/vendor/*', async (request, reply) => {
      const filename = (request.params as { '*': string })['*'];
      if (!filename || filename.includes('..')) {
        reply.code(400).send({ error: 'Invalid path' });
        return;
      }
      if (!(await serveStatic(join('vendor', filename), reply))) {
        reply.code(404).send({ error: 'File not found' });
      }
    });

    this.fastify.get('/js/*', async (request, reply) => {
      const filename = (request.params as { '*': string })['*'];
      if (!filename || filename.includes('..')) {
        reply.code(400).send({ error: 'Invalid path' });
        return;
      }
      if (!(await serveStatic(join('js', filename), reply))) {
        reply.code(404).send({ error: 'File not found' });
      }
    });

    this.fastify.register(healthRoutes);
    this.fastify.register(configRoutes);
    this.fastify.register(agentRoutes);
    this.fastify.register(skillRoutes);
    this.fastify.register(sessionRoutes);
    this.fastify.register(launcherRoutes);
    this.fastify.register(chatRoutes);
    this.fastify.register(fileRoutes);
    this.fastify.register(agentStateRoutes);
    this.fastify.register(skillFileRoutes);
    this.fastify.register(agentFileRoutes);
    this.fastify.register(crewRoutes);
    this.fastify.register(crewFileRoutes);
    this.fastify.register(devtoolRoutes);
    this.fastify.register(devtoolStreamRoutes);
    this.fastify.register(specRoutes);
    this.fastify.register(planRoutes);
    this.fastify.register(modelRoutes);

    // Decorate fastify with managers for route access
    this.fastify.decorate('configManager', this.configManager);
    this.fastify.decorate('resourceManager', this.resourceManager);
    this.fastify.decorate('sessionManager', this.sessionManager);

    // 4. Listen
    await this.fastify.listen({ port: this.options.port, host: this.options.host });
  }

  /** Gracefully stop server and clean up */
  async shutdown(): Promise<void> {
    this.sessionManager.stopAll();
    await this.fastify.close();
  }

  /** Current listen address (available after startup) */
  get address(): string {
    const addr = this.fastify.addresses()[0];
    if (!addr) throw new Error('Daemon not started');
    return typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
  }
}

// Auto-start when run directly (tsx watch / tsx src/daemon.ts)
if (process.argv[1]?.endsWith('daemon.ts') || process.argv[1]?.endsWith('daemon.js')) {
  const daemon = new Daemon();
  daemon
    .startup()
    .then(() => {
      console.log(`Daemon running at http://${daemon.address}`);
    })
    .catch((err) => {
      console.error('Daemon startup failed:', err);
      process.exit(1);
    });

  process.on('SIGINT', async () => {
    await daemon.shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await daemon.shutdown();
    process.exit(0);
  });
}
