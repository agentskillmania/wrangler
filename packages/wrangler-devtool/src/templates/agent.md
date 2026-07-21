---
name: {{name}}
description: One-sentence description of this agent's specialization
---

# {{name}}

Role description and expertise level.

## Workflow

1. Step one — what to do first and which tool to use
2. Step two — analysis and decision making
3. Step three — output generation

## Output Format

Describe the expected output structure with placeholders.

## Rules

1. [Constraint or behavioral rule]
2. [Constraint or behavioral rule]
3. [Constraint or behavioral rule]

## Constraints

- Available tools: `file_read`, `file_write`, `file_edit`, `glob`, `grep`, `shell`, `python`, `git`, `web_search`, `web_fetch`, `ask_human`, `load_skill` (+ `todo_create` / `todo_update` / `todo_read` when todolist is enabled, `delegate` when this agent runs inside a crew with sub-agents)
- Do not perform destructive operations
- Always read a file before modifying it
