import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
} from 'fastify';

import { setDefaultSkillFsOps } from '@agentskillmania/colts';
import { nodeFsOps } from '@agentskillmania/colts/skills/node-fs-ops';

import { CONFIG_PATH, AGENTS_DIR, SKILLS_DIR, SESSIONS_DIR, CREWS_DIR } from './constants.js';
import { ConfigManager } from './core/config-manager.js';
import { ResourceManager } from './core/resource-manager.js';
import { SessionManager } from './core/session-manager.js';
import { agentFileRoutes } from './routes/agent-files.js';
import { agentStateRoutes } from './routes/agent-state.js';
import { agentRoutes } from './routes/agents.js';
import { chatRoutes } from './routes/chat.js';
import { configRoutes } from './routes/config.js';
import { crewFileRoutes } from './routes/crew-files.js';
import { crewRoutes } from './routes/crews.js';
import { devtoolRoutes } from './routes/devtool.js';
import { fileRoutes } from './routes/files.js';
import { healthRoutes } from './routes/health.js';
import { launcherRoutes } from './routes/launcher.js';
import { modelRoutes } from './routes/models.js';
import { planRoutes } from './routes/plans.js';
import { sessionRoutes } from './routes/sessions.js';
import { skillFileRoutes } from './routes/skill-files.js';
import { skillRoutes } from './routes/skills.js';
import { specRoutes } from './routes/specs.js';
import type { DaemonOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register the Node SkillFsOps implementation once at daemon startup so any
// FilesystemSkillProvider (sessions, routes/skills.ts) resolves node:fs
// without colts importing node: modules itself. Idempotent.
setDefaultSkillFsOps(nodeFsOps);

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
  /** Raw CLI options (port/host). Resolved against config at startup. */
  private readonly cliOptions: DaemonOptions;

  constructor(options: DaemonOptions = {}) {
    this.cliOptions = options;

    // Pre-bound listener: hand the existing server to fastify instead of
    // creating a new one (mirrors Rust's Daemon::with_listener).
    // 非 http2 的 Fastify 工厂没有 `server` 选项（那是 http2 变体的）——
    // 用 serverFactory 把 fastify 的请求处理器挂到已有 http.Server 的
    // 'request' 事件上。显式 FastifyServerOptions 注解固定 RawServer 泛型
    // （条件展开会导致 TS 推断失败、fallback 到 http2 重载）。
    const fastifyOptions: FastifyServerOptions = {
      logger: false,
      ...(options.listener
        ? {
            serverFactory: (handler) => {
              const listener = options.listener!;
              listener.on('request', handler);
              return listener;
            },
          }
        : {}),
    };
    this.fastify = Fastify(fastifyOptions);
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
    this.fastify.register(specRoutes);
    this.fastify.register(planRoutes);
    this.fastify.register(modelRoutes);

    // Decorate fastify with managers for route access
    this.fastify.decorate('configManager', this.configManager);
    this.fastify.decorate('resourceManager', this.resourceManager);
    this.fastify.decorate('sessionManager', this.sessionManager);

    // 4. Listen — resolve port/host with CLI > config.yaml > default priority
    // (mirrors the Rust daemon's cli.rs flag→config→default chain). The
    // constructor only stores raw CLI options; config is loaded above, so the
    // effective bind address is decided here after both are available.
    // If a pre-bound listener was provided (with_listener pattern), the server
    // is already listening — just finish route registration via ready().
    if (this.cliOptions.listener) {
      await this.fastify.ready();
    } else {
      const config = this.configManager.get();
      const port = this.cliOptions.port ?? config.server.port;
      const host = this.cliOptions.host ?? config.server.host;
      await this.fastify.listen({ port, host });
    }
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
