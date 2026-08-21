# Workflow and worker diagnostics

Start with the smallest broad read and narrow only when the evidence supports it.

1. Use `workflow.count` or a bounded `workflow.list` to establish whether matching executions exist.
2. Use `workflow.describe` to inspect status, Workflow Type, Task Queue, start and close times, and retry/run identifiers.
3. Use `workflow.show` for event-history evidence. Focus on the latest Workflow Task, Activity Task, timer, cancellation, or failure transition.
4. Use `workflow.stack` when a running Workflow appears stuck and stack information is available.
5. Use `workflow.trace` to correlate the execution's timing and child/activity relationships.
6. Use `task_queue.describe` for poller and reachability evidence when work is scheduled but not progressing.
7. Use `schedule.describe` when the initiating Schedule, rather than the Workflow execution, is suspect.

State conclusions with confidence. Separate observed facts from inference, cite the operation that produced each fact, and say when an empty or permission-limited response prevents a stronger conclusion.
