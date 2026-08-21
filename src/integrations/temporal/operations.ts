export type TemporalExecutable = "temporal" | "tcld";

export interface FlagDefinition {
  takesValue: boolean;
  repeatable?: boolean;
}

export interface ReadonlyOperationDefinition {
  executable: TemporalExecutable;
  command: readonly string[];
  flags: Readonly<Record<string, FlagDefinition>>;
  injectNamespace: boolean;
}

const flag = (takesValue: boolean, repeatable = false): FlagDefinition => ({
  takesValue,
  repeatable,
});

export const READONLY_OPERATIONS = {
  "workflow.list": {
    executable: "temporal",
    command: ["workflow", "list"],
    flags: {
      "--archived": flag(false),
      "--limit": flag(true),
      "--page-size": flag(true),
      "--query": flag(true),
    },
    injectNamespace: true,
  },
  "workflow.count": {
    executable: "temporal",
    command: ["workflow", "count"],
    flags: { "--query": flag(true) },
    injectNamespace: true,
  },
  "workflow.describe": {
    executable: "temporal",
    command: ["workflow", "describe"],
    flags: {
      "--workflow-id": flag(true),
      "--run-id": flag(true),
      "--raw": flag(false),
      "--reset-points": flag(false),
    },
    injectNamespace: true,
  },
  "workflow.show": {
    executable: "temporal",
    command: ["workflow", "show"],
    flags: {
      "--workflow-id": flag(true),
      "--run-id": flag(true),
      "--detailed": flag(false),
      "--follow": flag(false),
      "--reverse": flag(false),
    },
    injectNamespace: true,
  },
  "workflow.stack": {
    executable: "temporal",
    command: ["workflow", "stack"],
    flags: {
      "--workflow-id": flag(true),
      "--run-id": flag(true),
      "--reject-condition": flag(true),
    },
    injectNamespace: true,
  },
  "workflow.trace": {
    executable: "temporal",
    command: ["workflow", "trace"],
    flags: {
      "--workflow-id": flag(true),
      "--run-id": flag(true),
      "--concurrency": flag(true),
      "--depth": flag(true),
      "--fold": flag(true, true),
      "--no-fold": flag(false),
    },
    injectNamespace: true,
  },
  "task_queue.describe": {
    executable: "temporal",
    command: ["task-queue", "describe"],
    flags: {
      "--task-queue": flag(true),
      "--task-queue-type": flag(true),
      "--disable-stats": flag(false),
      "--legacy-mode": flag(false),
      "--partitions-legacy": flag(true),
      "--report-config": flag(false),
      "--report-reachability": flag(false),
      "--select-all-active": flag(false),
      "--select-build-id": flag(true, true),
      "--select-unversioned": flag(false),
      "--task-queue-type-legacy": flag(true),
    },
    injectNamespace: true,
  },
  "schedule.list": {
    executable: "temporal",
    command: ["schedule", "list"],
    flags: {
      "--long": flag(false),
      "--query": flag(true),
      "--really-long": flag(false),
    },
    injectNamespace: true,
  },
  "schedule.describe": {
    executable: "temporal",
    command: ["schedule", "describe"],
    flags: { "--schedule-id": flag(true) },
    injectNamespace: true,
  },
  "batch.list": {
    executable: "temporal",
    command: ["batch", "list"],
    flags: { "--limit": flag(true) },
    injectNamespace: true,
  },
  "batch.describe": {
    executable: "temporal",
    command: ["batch", "describe"],
    flags: { "--job-id": flag(true) },
    injectNamespace: true,
  },
  "cluster.health": {
    executable: "temporal",
    command: ["operator", "cluster", "health"],
    flags: {},
    injectNamespace: true,
  },
  "account.get": {
    executable: "tcld",
    command: ["account", "get"],
    flags: {},
    injectNamespace: false,
  },
  "account.list_regions": {
    executable: "tcld",
    command: ["account", "list-regions"],
    flags: {},
    injectNamespace: false,
  },
  "namespace.get": {
    executable: "tcld",
    command: ["namespace", "get"],
    flags: {},
    injectNamespace: true,
  },
  "namespace.list": {
    executable: "tcld",
    command: ["namespace", "list"],
    flags: { "--page-token": flag(true), "--page-size": flag(true) },
    injectNamespace: false,
  },
  "namespace.lifecycle_get": {
    executable: "tcld",
    command: ["namespace", "lifecycle", "get"],
    flags: {},
    injectNamespace: true,
  },
  "namespace.retention_get": {
    executable: "tcld",
    command: ["namespace", "retention", "get"],
    flags: {},
    injectNamespace: true,
  },
  "namespace.auth_method_get": {
    executable: "tcld",
    command: ["namespace", "auth-method", "get"],
    flags: {},
    injectNamespace: true,
  },
  "namespace.capacity_get": {
    executable: "tcld",
    command: ["namespace", "capacity", "get"],
    flags: {},
    injectNamespace: true,
  },
  "apikey.get": {
    executable: "tcld",
    command: ["apikey", "get"],
    flags: { "--id": flag(true) },
    injectNamespace: false,
  },
  "apikey.list": {
    executable: "tcld",
    command: ["apikey", "list"],
    flags: { "--owner-id": flag(true), "--owner-type": flag(true) },
    injectNamespace: false,
  },
  "service_account.get": {
    executable: "tcld",
    command: ["service-account", "get"],
    flags: { "--service-account-id": flag(true) },
    injectNamespace: false,
  },
  "service_account.list": {
    executable: "tcld",
    command: ["service-account", "list"],
    flags: { "--page-token": flag(true), "--page-size": flag(true) },
    injectNamespace: false,
  },
  "user.get": {
    executable: "tcld",
    command: ["user", "get"],
    flags: { "--user-email": flag(true), "--user-id": flag(true) },
    injectNamespace: false,
  },
  "user.list": {
    executable: "tcld",
    command: ["user", "list"],
    flags: { "--page-token": flag(true), "--page-size": flag(true) },
    injectNamespace: true,
  },
  "user_group.get": {
    executable: "tcld",
    command: ["user-group", "get"],
    flags: { "--group-id": flag(true) },
    injectNamespace: false,
  },
  "user_group.list": {
    executable: "tcld",
    command: ["user-group", "list"],
    flags: { "--page-token": flag(true), "--page-size": flag(true) },
    injectNamespace: false,
  },
  "user_group.list_members": {
    executable: "tcld",
    command: ["user-group", "list-members"],
    flags: { "--group-id": flag(true) },
    injectNamespace: false,
  },
} as const satisfies Record<string, ReadonlyOperationDefinition>;

export type ReadonlyTemporalOperation = keyof typeof READONLY_OPERATIONS;
export const READONLY_OPERATION_IDS = Object.keys(
  READONLY_OPERATIONS
) as ReadonlyTemporalOperation[];

export function isReadonlyTemporalOperation(
  value: string
): value is ReadonlyTemporalOperation {
  return Object.prototype.hasOwnProperty.call(READONLY_OPERATIONS, value);
}
