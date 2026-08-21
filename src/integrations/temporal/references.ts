import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPORAL_REFERENCE_PATHS = [
  "authentication.md",
  "connectivity.md",
  "workflow-diagnostics.md",
] as const;

export type TemporalReferencePath = (typeof TEMPORAL_REFERENCE_PATHS)[number];
const MAX_REFERENCE_BYTES = 131_072;

export function defaultTemporalReferenceRoot(): string {
  return fileURLToPath(
    new URL("../../../skills/temporal-ops/references/", import.meta.url)
  );
}

export async function readTemporalReference(
  requestedPath: string,
  root = defaultTemporalReferenceRoot()
): Promise<{ path: TemporalReferencePath; content: string }> {
  if (
    !TEMPORAL_REFERENCE_PATHS.includes(requestedPath as TemporalReferencePath)
  ) {
    throw new Error("Unknown Temporal reference path");
  }
  if (
    requestedPath.includes("\\") ||
    requestedPath.includes("\0") ||
    requestedPath.split("/").some((segment) => segment.length === 0 || segment === "..")
  ) {
    throw new Error("Invalid Temporal reference path");
  }

  const resolvedRoot = await realpath(root);
  const candidate = resolve(resolvedRoot, requestedPath);
  if (!candidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error("Temporal reference path escapes the reference root");
  }
  const metadata = await lstat(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Temporal reference is not a regular file");
  }
  if (metadata.size > MAX_REFERENCE_BYTES) {
    throw new Error("Temporal reference is too large");
  }
  const resolvedCandidate = await realpath(candidate);
  if (dirname(resolvedCandidate) !== resolvedRoot) {
    throw new Error("Temporal reference path escapes the reference root");
  }

  return {
    path: requestedPath as TemporalReferencePath,
    content: await readFile(resolvedCandidate, "utf8"),
  };
}
