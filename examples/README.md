# Examples

Runnable starting points for the two sides of the Journal Bastion protocol.

| File | What it is |
|------|-----------|
| [`bastion.json`](./bastion.json) | Sample bastion config (stdio + streamable-http servers, a skills dir). The `$schema` line gives you autocomplete and validation in editors like VS Code. |
| [`bastion.env.example`](./bastion.env.example) | Environment variables required by `bastion.json`. |
| [`integrations/`](./integrations) | Customer-facing MCP integration examples, including SQL database configs and a curated enterprise MCP server catalog. |
| [`hub-server.ts`](./hub-server.ts) | Minimal service-side server using `@journal/journal-bastion`. |
| [`hub_server.py`](./hub_server.py) | The same, using `@journal/journal-bastion`. |

## Try it end to end

1. **Start a client server** (the service side that bastions connect to):

   ```bash
   # TypeScript
   npm install @journal/journal-bastion
   npx tsx hub-server.ts

   # or Python
   pip install @journal/journal-bastion
   python hub_server.py
   ```

   Both listen on `ws://localhost:8080` and accept the token `gw_demo`.

2. **Run a bastion** pointed at it. Copy `bastion.env.example` to `.env`, edit the
   database/API values for your environment, then:

   ```bash
   npm install -g @journal/journal-bastion

   journal-bastion --env-file .env --config bastion.json
   ```

   If you only want to test the connection lifecycle, trim `bastion.json` to `{}`
   and keep only `JOURNAL_BASTION_TOKEN` and `JOURNAL_BASTION_URL` in `.env`.
   With placeholder database/API values, the bastion still connects, but those
   MCP servers are skipped and expose no tools until you provide real values.

The client server prints each bastion as it connects along with the tools it exposes.

See the [root README](../README.md) for the full configuration and protocol reference.
For database deployments, start with the [database integration guide](./integrations/database/README.md).
