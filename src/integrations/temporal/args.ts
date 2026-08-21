import type { TemporalConfig } from "./config.js";
import {
  READONLY_OPERATIONS,
  type ReadonlyTemporalOperation,
} from "./operations.js";

const MAX_ARGUMENTS = 32;
const MAX_ARGUMENT_BYTES = 8_192;
const MAX_SINGLE_ARGUMENT_BYTES = 2_048;

export interface ValidatedInvocation {
  executable: "temporal" | "tcld";
  args: string[];
}

export function buildReadonlyInvocation(
  operation: ReadonlyTemporalOperation,
  suppliedArgs: readonly string[],
  config: TemporalConfig
): ValidatedInvocation {
  const definition = READONLY_OPERATIONS[operation];
  if (suppliedArgs.length > MAX_ARGUMENTS) {
    throw new Error(`Too many arguments for ${operation}`);
  }

  let totalBytes = 0;
  const seen = new Set<string>();
  const validated: string[] = [];

  for (let index = 0; index < suppliedArgs.length; index += 1) {
    const argument = suppliedArgs[index];
    if (typeof argument !== "string") {
      throw new Error("Temporal arguments must be strings");
    }
    const bytes = Buffer.byteLength(argument);
    totalBytes += bytes;
    if (bytes === 0 || bytes > MAX_SINGLE_ARGUMENT_BYTES) {
      throw new Error("Temporal argument length is invalid");
    }
    if (totalBytes > MAX_ARGUMENT_BYTES) {
      throw new Error("Temporal arguments are too large");
    }
    if (/\p{Cc}/u.test(argument)) {
      throw new Error("Temporal arguments must not contain control characters");
    }
    if (!argument.startsWith("--") || argument.includes("=")) {
      throw new Error(`Only allowlisted long-form flags are accepted: ${argument}`);
    }

    const flag = definition.flags[argument as keyof typeof definition.flags] as
      | { takesValue: boolean; repeatable?: boolean }
      | undefined;
    if (!flag) {
      throw new Error(`Flag is not allowed for ${operation}: ${argument}`);
    }
    if (!flag.repeatable && seen.has(argument)) {
      throw new Error(`Flag may not be repeated: ${argument}`);
    }
    seen.add(argument);
    validated.push(argument);

    if (flag.takesValue) {
      const flagValue = suppliedArgs[index + 1];
      if (
        typeof flagValue !== "string" ||
        flagValue.length === 0 ||
        flagValue.startsWith("--")
      ) {
        throw new Error(`Flag requires a value: ${argument}`);
      }
      if (/\p{Cc}/u.test(flagValue)) {
        throw new Error("Temporal arguments must not contain control characters");
      }
      const valueBytes = Buffer.byteLength(flagValue);
      totalBytes += valueBytes;
      if (
        valueBytes > MAX_SINGLE_ARGUMENT_BYTES ||
        totalBytes > MAX_ARGUMENT_BYTES
      ) {
        throw new Error("Temporal arguments are too large");
      }
      validated.push(flagValue);
      index += 1;
    }
  }

  if (definition.executable === "temporal") {
    return {
      executable: "temporal",
      args: [
        ...definition.command,
        ...validated,
        "--address",
        config.address,
        "--namespace",
        config.namespace,
        "--output",
        "json",
        "--color",
        "never",
        "--command-timeout",
        "40s",
      ],
    };
  }

  return {
    executable: "tcld",
    args: [
      ...definition.command,
      ...validated,
      ...(definition.injectNamespace ? ["--namespace", config.namespace] : []),
    ],
  };
}
