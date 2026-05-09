import type { AgentInstance } from './agent-instance.js';
import type { CrewOutputEvent } from './types.js';
import type { MessageRouter } from './message-router.js';

export interface SchedulerOptions {
  router: MessageRouter;
  onAdvance: (agent: AgentInstance) => Promise<void>;
  emit: (event: CrewOutputEvent) => void;
}

export class Scheduler {
  private router: MessageRouter;
  private onAdvance: (agent: AgentInstance) => Promise<void>;
  private emit: (event: CrewOutputEvent) => void;

  constructor(options: SchedulerOptions) {
    this.router = options.router;
    this.onAdvance = options.onAdvance;
    this.emit = options.emit;
  }

  async scheduleOnce(agents: Map<string, AgentInstance>): Promise<void> {
    for (const agent of agents.values()) {
      if (agent.status !== 'idle') continue;
      if (!agent.hasMessages) continue;

      agent.dequeue();
      agent.setRunning();

      try {
        await this.onAdvance(agent);
      } catch (e) {
        this.emit({
          type: 'error',
          error: e instanceof Error ? e : new Error(String(e)),
        });
      } finally {
        agent.setIdle();
      }
    }
  }
}
