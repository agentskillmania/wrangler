import type { CrewTodoItem, CrewTodoStatus } from './types.js';

export class CrewTodoList {
  private _items: CrewTodoItem[] = [];
  private _nextId = 0;

  get items(): readonly CrewTodoItem[] {
    return this._items;
  }

  add(content: string, assignee?: string): string {
    const id = `ct-${++this._nextId}`;
    this._items.push({ id, content, status: 'pending', assignee });
    return id;
  }

  update(id: string, status: CrewTodoStatus): void {
    const item = this._items.find((i) => i.id === id);
    if (!item) throw new Error(`Todo item ${id} not found`);
    this._items = this._items.map((i) => (i.id === id ? { ...i, status } : i));
  }

  remove(id: string): void {
    this._items = this._items.filter((i) => i.id !== id);
  }

  snapshot(): readonly CrewTodoItem[] {
    return Object.freeze([...this._items]);
  }
}
