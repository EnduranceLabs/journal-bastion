---
name: temporal-ops
description: Diagnose Temporal Cloud workflows, task queues, schedules, connectivity, and Namespace health through the permanently read-only Temporal integration.
---

# Temporal Cloud diagnostics

Use this skill when investigating Temporal Cloud behavior in the single Namespace configured by the customer. The integration is permanently read-only and fixes the address, Namespace, and credentials outside the model's control.

All executable inspection goes through `temporal.inspect`. Never propose or attempt a command outside its advertised operation enum. Use `temporal.read_reference` for the bundled diagnostic guides.

## Diagnostic sequence

1. Establish connectivity with `cluster.health` and `workflow.list` using `--limit`, `1`. A successful empty workflow list proves TLS, authentication, authorization, endpoint, and Namespace resolution.
2. Narrow the symptom with `workflow.count`, then `workflow.describe` for a known Workflow ID.
3. Inspect execution evidence with `workflow.show`, `workflow.stack`, or `workflow.trace` when their input is available.
4. For work that is not progressing, inspect `task_queue.describe` and compare poller evidence with Workflow state.
5. For scheduled work, use `schedule.list` and `schedule.describe`.
6. For Cloud configuration context, use `namespace.get`, `namespace.capacity_get`, and the other advertised Namespace inspection operations. A permission error is evidence about the API key's Cloud control-plane scope; report it without trying another identity.

## Argument conventions

Arguments are an array of separate long-form flag/value strings. The target, credentials, output format, and timeouts are injected by the integration and cannot be overridden.

Example inspection input:

```json
{
  "operation": "workflow.list",
  "args": ["--limit", "1"]
}
```

For a specific execution:

```json
{
  "operation": "workflow.describe",
  "args": ["--workflow-id", "example-workflow-id"]
}
```

## References

- Read `connectivity.md` before interpreting transport or authentication failures.
- Read `workflow-diagnostics.md` for the bottom-up workflow and worker diagnostic ladder.
- Read `authentication.md` for the fixed Temporal Cloud API-key boundary.

This curated skill is derived from `temporalio/skill-temporal-ops` version 0.2.0 at commit `c2f76025159e9580f9e89ff1be1bb5db2e2f428e`, under the MIT license.
