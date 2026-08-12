---
name: add-message
description: Add a new message type to the bastion protocol
disable-model-invocation: true
argument-hint: "[message-name] [direction: bastion|service]"
---

# Add a Protocol Message Type

Follow these steps to add a new message to the Journal Bastion Protocol.

The first argument is the message name (e.g., `heartbeat_ack`). The second argument is the direction: `bastion` (bastion -> service) or `service` (service -> bastion).

## 1. Add the Zod schema and TypeScript type

Open `protocol/src/messages.ts` and add the Zod schema + type export.

Place it in the correct section based on direction:
- **Bastion -> Service:** after the existing bastion messages (before `BastionMessageSchema`)
- **Service -> Bastion:** after the existing service messages (before `ServiceMessageSchema`)

```ts
export const MyNewMessageSchema = z.object({
  type: z.literal("my_new"),
  field1: z.string(),
});

export type MyNewMessage = z.infer<typeof MyNewMessageSchema>;
```

## 2. Add to the discriminated union

In the same file (`protocol/src/messages.ts`), add the new schema to the appropriate `z.discriminatedUnion("type", [...])`:

- **Bastion -> Service:** add to `BastionMessageSchema`
- **Service -> Bastion:** add to `ServiceMessageSchema`

## 3. Re-export from index.ts

Open `protocol/src/index.ts` and add the schema and type to the re-exports from `"./messages.js"`:

```ts
export {
  // ... existing exports ...
  MyNewMessageSchema,
  type MyNewMessage,
} from "./messages.js";
```

## 4. Update the protocol spec

Open `spec/protocol.md` and add documentation for the new message type.

Add it under the appropriate section ("Bastion -> Service" or "Service -> Bastion"):

```markdown
#### `my_new`

Description of the message.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"my_new"` | yes | Message discriminator |
| `field1` | `string` | yes | Field description |
```

If the message changes the connection lifecycle, update the ASCII diagram at the top.

## 5. Add tests

Open `bastion/src/__tests__/messages.test.ts` and add tests.

Add in the appropriate `describe` block ("Bastion -> Service messages" or "Service -> Bastion messages"):

```ts
it("parses my_new message", () => {
  const msg = {
    type: "my_new",
    field1: "value",
  };
  expect(MyNewMessageSchema.parse(msg)).toEqual(msg);
});
```

Also verify it works through the discriminated union by adding the message to the array in the "parses all bastion/service message types via discriminated union" test.

Add rejection tests for any required fields or validation constraints:

```ts
it("rejects my_new with missing field1", () => {
  const msg = { type: "my_new" };
  expect(() => MyNewMessageSchema.parse(msg)).toThrow();
});
```

## 6. Keep clients and docs in sync

- TypeScript clients re-export protocol types from `clients/typescript/src/types.ts`.
  Add the new schema/type there if it should be public from the client package.
- Python clients define their own dataclasses and message handling in
  `clients/python/journal_bastion_client/`. Update them when the message changes
  runtime behavior or public data shapes.
- If the message changes lifecycle, timeout, retry, trace, or catalog behavior,
  update `README.md`, `ARCHITECTURE.md`, and the relevant client README files.

## 7. Run checks

```bash
pnpm -r build         # Build workspace TypeScript packages
pnpm test             # Bastion tests
pnpm test:client      # TypeScript client tests
pnpm test:integration # TypeScript integration (bastion <-> TS client)
pnpm test:python      # Python client tests
```

## Key files

- `spec/protocol.md` — Protocol specification
- `protocol/src/messages.ts` — Zod schemas and discriminated unions
- `protocol/src/index.ts` — Re-exports
- `clients/typescript/src/types.ts` — Client package re-exports
- `clients/python/journal_bastion_client/` — Python client types and handlers
- `bastion/src/__tests__/messages.test.ts` — Message parsing tests
