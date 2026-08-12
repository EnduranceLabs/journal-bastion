# @journal-labs/bastion/protocol

Shared TypeScript types and [Zod](https://zod.dev) schemas for the Journal
Bastion WebSocket protocol.

Most applications should install `journal-bastion` or
`@journal-labs/bastion` instead. Install this package directly when you
need to validate protocol messages, share bastion types across packages, or
build custom tooling around the protocol.

## Install

```bash
npm install @journal-labs/bastion/protocol
```

## Exports

- WebSocket message schemas for bastion-to-service and service-to-bastion
  messages.
- Integration types: `Integration`, `ToolDefinition`, `ToolResult`, and content
  blocks.
- Skill types for markdown skills published by bastions.
- Typed bastion errors and error codes.
- Provider interfaces used by bastion implementations.

The package has one runtime dependency: `zod`.

## Usage

```ts
import {
  BastionMessageSchema,
  ServiceMessageSchema,
  type BastionMessage,
  type ToolResult,
} from "@journal-labs/bastion/protocol";

export function parseBastionMessage(raw: string): BastionMessage {
  return BastionMessageSchema.parse(JSON.parse(raw));
}

export function readText(result: ToolResult): string[] {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text);
}

ServiceMessageSchema.parse({
  type: "ping",
});
```

## Version Compatibility

Journal Bastion packages release in lockstep. Use matching versions of:

- npm `journal-bastion`
- npm `@journal-labs/bastion` for TypeScript services
- npm `@journal-labs/bastion/protocol`
- PyPI `@journal-labs/bastion` for Python services

## More Documentation

- [Protocol spec](https://github.com/EnduranceLabs/journal-bastion/blob/main/spec/protocol.md)
- [Full README](https://github.com/EnduranceLabs/journal-bastion#readme)

## License

MIT
