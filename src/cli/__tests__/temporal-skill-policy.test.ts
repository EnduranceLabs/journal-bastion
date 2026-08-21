import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  isReadonlyTemporalOperation,
  READONLY_OPERATIONS,
} from "../../integrations/temporal/operations.js";
import { TEMPORAL_REFERENCE_PATHS } from "../../integrations/temporal/references.js";

const skillPath = new URL(
  "../../../skills/temporal-ops/temporal-ops.md",
  import.meta.url
);

describe("Temporal skill policy", () => {
  it("mentions only manifest operations in executable examples", async () => {
    const content = await readFile(skillPath, "utf8");
    const operations = [
      ...content.matchAll(/"operation"\s*:\s*"([^"]+)"/g),
    ].map((match) => match[1]);
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.every(isReadonlyTemporalOperation)).toBe(true);
  });

  it("contains no mutation command in the checked-in manifest", () => {
    const commands = Object.values(READONLY_OPERATIONS).map((definition) =>
      definition.command.join(" ")
    );
    expect(commands.join("\n")).not.toMatch(
      /\b(create|delete|disable|enable|execute|invite|reset|set|signal|start|terminate|update)\b/
    );
  });

  it("lists only references served by the adapter", async () => {
    const content = await readFile(skillPath, "utf8");
    const mentioned = [...content.matchAll(/`([^`]+\.md)`/g)].map(
      (match) => match[1]
    );
    expect(mentioned.sort()).toEqual([...TEMPORAL_REFERENCE_PATHS].sort());
  });
});
