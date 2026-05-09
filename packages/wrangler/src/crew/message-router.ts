import type { CrewMessage } from './types.js';

export class MessageRouter {
  private queues = new Map<string, CrewMessage[]>();

  enqueue(targetId: string, message: CrewMessage): void {
    let queue = this.queues.get(targetId);
    if (!queue) {
      queue = [];
      this.queues.set(targetId, queue);
    }
    queue.push(message);
  }

  dequeue(agentId: string): CrewMessage[] {
    const queue = this.queues.get(agentId);
    if (!queue) return [];
    this.queues.set(agentId, []);
    return [...queue];
  }

  hasMessages(agentId: string): boolean {
    return (this.queues.get(agentId)?.length ?? 0) > 0;
  }

  agentsWithMessages(): string[] {
    const result: string[] = [];
    for (const [id, queue] of this.queues) {
      if (queue.length > 0) result.push(id);
    }
    return result;
  }
}
