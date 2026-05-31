import { describe, it, expect } from 'vitest';
import { CrewTodoList } from '../../../src/crew/crew-todolist.js';

describe('CrewTodoList', () => {
  it('starts empty', () => {
    const tl = new CrewTodoList();
    expect(tl.items).toEqual([]);
  });

  it('adds item', () => {
    const tl = new CrewTodoList();
    const id = tl.add('search for x');
    expect(tl.items).toHaveLength(1);
    expect(tl.items[0].id).toBe(id);
    expect(tl.items[0].content).toBe('search for x');
    expect(tl.items[0].status).toBe('pending');
  });

  it('adds item with assignee', () => {
    const tl = new CrewTodoList();
    tl.add('task', 'worker-1');
    expect(tl.items[0].assignee).toBe('worker-1');
  });

  it('updates item status', () => {
    const tl = new CrewTodoList();
    const id = tl.add('task');
    tl.update(id, 'in_progress');
    expect(tl.items[0].status).toBe('in_progress');
  });

  it('throws on update non-existent item', () => {
    const tl = new CrewTodoList();
    expect(() => tl.update('nope', 'completed')).toThrow();
  });

  it('removes item', () => {
    const tl = new CrewTodoList();
    const id = tl.add('task');
    tl.remove(id);
    expect(tl.items).toHaveLength(0);
  });

  it('snapshot returns immutable copy', () => {
    const tl = new CrewTodoList();
    tl.add('task');
    const snap = tl.snapshot();
    expect(snap).toHaveLength(1);
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('should maintain independent ID sequences per instance', () => {
    const tl1 = new CrewTodoList();
    const tl2 = new CrewTodoList();

    const id1a = tl1.add('task-a');
    const id2a = tl2.add('task-b');
    const id1b = tl1.add('task-c');

    // Each instance starts from ct-1 independently
    expect(id1a).toBe('ct-1');
    expect(id2a).toBe('ct-1');
    expect(id1b).toBe('ct-2');

    // Items are isolated per instance
    expect(tl1.items).toHaveLength(2);
    expect(tl2.items).toHaveLength(1);
  });
});
