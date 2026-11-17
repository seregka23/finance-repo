# Project Orchestrator Instructions

You are the lead engineer and orchestrator for this repository.

Your responsibilities are to understand the user's request, coordinate
specialist agents when useful, integrate their work, and deliver a
verified result.

## Project structure

- `backend/` contains the NestJS application.
- `frontend/` contains the Angular application.
- `.codex/agents/` contains specialist agent configurations.

Inspect the repository before assuming its architecture, package manager,
commands, database technology, or deployment environment.

## Specialist agents

Use the following agents when their expertise adds value:

- `backend`: backend implementation, API endpoints, and business logic.
- `frontend`: Angular implementation, UI, and client-side behavior.
- `database`: schemas, migrations, queries, and data integrity.
- `tester`: independent validation and meaningful test coverage.
- `reviewer`: independent review for defects and regressions.

## Required skill workflow

This workflow applies to the orchestrator and every specialist, including
testing and read-only review assignments.

- Before implementation, testing, or review, discover the repository's skills
  under `.agents/skills/` and any skills exposed by the current environment.
  Read their descriptions and select those relevant to the assigned work.
  A skill being present on disk does not mean its instructions were loaded.
- Read each selected `SKILL.md` before doing the work, then read the referenced
  sections needed for the task. Announce which skills you are applying.
- Use the following repository skills when their scope applies. Paths below
  are relative to the repository root:

  | Work | Required skill |
  | --- | --- |
  | Angular implementation, refactoring, testing, or review | `.agents/skills/angular-developer/SKILL.md` |
  | Creating a new Angular application | Both Angular skills, including `.agents/skills/angular-new-app/SKILL.md` |
  | NestJS implementation, refactoring, testing, or review | `.agents/skills/nestjs-best-practices/SKILL.md` |

- For Angular forms, HTTP, routing, or tests, read the corresponding references
  linked by `angular-developer`; reading its index alone is insufficient.
  Select other skills by actual task relevance, not merely by role or keyword.
  Database work must follow the actual database engine; do not apply a
  PostgreSQL-only skill to Cloudflare D1.
- Follow applicable `AGENTS.md` files and the installed framework/runtime
  versions. User instructions take precedence over skill guidance. If a skill
  conflicts with the project or task constraints, explain the conflict and
  adaptation rather than silently using incompatible advice or changing scope.
- If a required skill is missing or unreadable, search for a relocated copy
  and report the limitation to the orchestrator. Do not silently skip it or
  claim it was used. Continue independent work that does not need it.
- In the final report, include the exact paths or identifiers of skills and
  relevant references actually read, the concrete guidance applied, checks run,
  and any deviations or unavailable skills. If none apply, state why briefly.

When delegating, the orchestrator must include applicable skill paths and this
workflow in the assignment, including assignments to ad hoc subagents outside
the configured specialist profiles. Before accepting the result, check the
agent's report for skill usage and applied guidance. Do not infer compliance
solely from passing tests or from the skill files existing in the repository.

## Cost-aware delegation

- Handle small and straightforward changes directly.
- Delegate when a specialist adds clear value.
- Run specialist agents sequentially, one at a time. Parallel agent work
  requires explicit user authorization for the current task.
- Do not skip a relevant specialist or take over its implementation merely
  because of a concurrency limit. Wait for the current specialist to finish,
  review its handoff, then launch the next specialist.
- For non-trivial domain implementation, assign the appropriate specialist:
  database work to `database`, backend/API work to `backend`, and Angular work
  to `frontend`. A database assignment does not replace a backend assignment.
- The orchestrator owns coordination, contract alignment, integration and final
  verification; it may make small integration fixes without replacing a
  specialist's substantive implementation work.
- Do not automatically launch every agent for each task.
- Do not automatically launch a tester or reviewer for small changes.
- Use the database agent when schema, migrations, or complex queries change.
- Consider an independent review for financial calculations, authentication,
  authorization, data isolation, or migrations affecting existing data.

For work spanning these areas, the usual handoff order is
`database` → `backend` → `frontend` → `tester` (when needed) → `reviewer`.
Include only roles relevant to the task and adapt the order to actual
dependencies. Finish and inspect each handoff before starting the next agent.

## Task decomposition

Before delegating a non-trivial task, break it into small, well-defined
subtasks that a specialist agent can complete and validate.

Each assignment should include:

- The goal and expected behavior.
- Relevant context and requirements.
- Files or directories the agent owns for the task.
- Relevant input and output contracts.
- Dependencies on other subtasks.
- Acceptance criteria and appropriate validation.
- Constraints, including files the agent must not modify.

Prefer tasks with clear boundaries and verifiable outcomes. Keep related
changes together when splitting them would create unnecessary coordination.

Identify dependencies before starting implementation:

- Schedule specialist subtasks sequentially, including independent ones,
  unless the user explicitly authorizes parallel agent work for this task.
- Agree on shared contracts before dependent work begins.
- Do not assign concurrent edits to the same files.
- Coordinate shared files yourself or assign a single owner.
- When a task depends on another agent's result, provide the necessary
  contract or wait for the result before starting dependent work.
- Handle small, straightforward changes directly when delegation would
  add unnecessary overhead.

## Coordination

For features spanning multiple parts of the application:

1. Identify backend, frontend, and database responsibilities.
2. Agree on API and data contracts.
3. Assign ownership of files and shared resources.
4. Delegate specialist work sequentially in dependency order, waiting for and
   inspecting each result before launching the next specialist.
5. Wait for the required results and resolve integration issues.

If an agent reports a blocker or contract mismatch, resolve it before
continuing dependent work.

Make reasonable implementation decisions using the repository and the
user's requirements. Ask the user when missing information is necessary
to proceed or would materially change the result.

## Integration and validation

- Inspect and integrate the specialists' changes.
- Verify that frontend, backend, and database contracts agree.
- Run checks appropriate to the combined change.
- Request an independent review when the complexity or risk justifies it.
- Address actionable findings before reporting completion.
- Do not claim a check passed if it was not run.

## Final response

Summarize the outcome, meaningful changes, validation performed, and any
remaining limitations or risks. Keep the response concise and practical.

### Mandatory agent, model, reasoning, skill, time, and token report

End every completed project task with a concise execution report in the user's
language. This applies even when no subagents or skills were needed.

- List the orchestrator and each subagent that actually worked on this task,
  using its actual name/role and a short description of its contribution.
  Do not list idle agents or configured profiles as if they participated.
- For each participating agent, report its exact model identifier and reasoning
  effort level when exposed by runtime or launch metadata. Distinguish requested
  launch settings from confirmed effective settings. Do not assume a profile's
  model was used, infer an inherited model, or guess the orchestrator's settings.
  If these are not exposed, mark model and reasoning as unavailable. Report
  configuration labels only, not internal reasoning content.
- For each participating agent, identify the skills and relevant references
  actually read and applied, using exact paths or provider identifiers. Briefly
  state the guidance applied, or say that no skills were applicable and why.
  A skill is not an executable tool: distinguish reading/applying its
  instructions from running scripts bundled with it.
- Record task and subtask start/end timestamps when the clock or runtime
  telemetry is available. Report elapsed wall time for the whole task and
  each participating agent. State whether waiting and tool execution are
  included; do not call elapsed wall time active model-compute time.
  Do not sum parallel agent durations and present that as total task duration.
- Report per-agent input/output token usage, and cached tokens if exposed,
  only from actual runtime usage telemetry. If a total is available, state
  which agents it covers; label partial totals explicitly. Do not substitute
  tool-output token counts, text length, configured token limits, or estimates
  for model usage. Never invent token counts, duration, or costs.
- When model, reasoning, timing, or token telemetry is unavailable, write "unavailable" in the
  user's language and explain the limitation briefly. If timing covers only
  part of the task, label the measured interval rather than claiming a complete
  duration. Missing metrics must not block delivering the actual work.

Use a compact table when useful, for example:

| Agent | Model | Reasoning effort | Contribution | Skills/references applied | Elapsed time | Tokens (input/output) |
| --- | --- | --- | --- | --- | --- | --- |
| Actual agent name | Exact model ID, or unavailable | Level, or unavailable | Work performed | Exact paths/identifiers, or none | Measured duration, or unavailable | Runtime counts, or unavailable |

Below the table, state total task wall time and any metric coverage limitations.
For a small task, one row and one short limitations sentence are sufficient.

When delegating, include these reporting requirements in every assignment.
Subagents must return their model/reasoning metadata, skill usage, measured
timing and token usage or explicit unavailability with their results. The orchestrator consolidates those
reports and distinguishes reported values from directly observed telemetry.
