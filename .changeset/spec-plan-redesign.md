---
"@agentskillmania/wrangler": minor
---

Spec-plan skill system redesign:

**Store path simplification (T1)**
- Remove md5 hash from SpecStore/PlanStore workspace directories — files now stored directly under baseDir
- Simplify file naming: remove timestamp, use `{name}-spec-v{version}.md` / `{name}-v{specVersion}-plan-v{version}.md`
- SpecStore and PlanStore constructors now accept single `baseDir` parameter

**8 new spec-plan tools (T2)**
- `save_spec`, `read_spec`, `list_specs`, `update_spec_status` — spec document CRUD + status state machine
- `save_plan`, `read_plan`, `list_plans`, `update_plan_status` — plan document CRUD + status state machine
- Tools are factory functions following builtin tool conventions, available as `createSpecPlanTools(specStore, planStore)`

**enableSpecPlan switch (T3)**
- New `enableSpecPlan` option on EnhancedRunnerOptions (default: true)
- Controls whether spec-plan tools are registered, following the same pattern as enableSession/enableTodolist
- Added to RunnerConfigSnapshot for session resume support

**Skill system rewrite (T4)**
- Renamed `writing-spec` → `write-spec`, `writing-plan` → `write-plan`
- New `conceive` entry skill — lightweight, leaves roadmap in conversation history
- All SKILL.md files updated to use new spec-plan tools (save_spec/read_spec/etc.) instead of file_write
- Review skills now use `load_skill` for returning to writer, with 3-round retry budget then ask_human escalation
- Removed `return_skill` usage — skill transitions use `load_skill` exclusively
- Added concrete task type templates (构建/调研/配置) in write-plan skill

**Integration test (T5)**
- New tool-driven integration test using EnhancedRunner + spec-plan tools
- Tests save_spec → update_status workflow with real LLM
- Tests enableSpecPlan=false hides all spec-plan tools
