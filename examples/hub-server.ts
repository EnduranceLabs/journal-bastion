// Minimal Journal Bastion client server (TypeScript).
//
//   npm install journal-bastion-hub
//   npx tsx hub-server.ts
//
// Then point a bastion at ws://localhost:8080 with token "gw_demo":
//   JOURNAL_BASTION_TOKEN=gw_demo \
//   JOURNAL_BASTION_URL=ws://localhost:8080 \
//   journal-bastion --config bastion.json

import { BastionServer } from "journal-bastion-hub";

const server = new BastionServer({
  port: 8080,
  validateToken: async (token) =>
    token === "gw_demo" ? { organizationId: "org_demo" } : null,
});

server.onBastionConnected = (bastion) => {
  console.log(`bastion ${bastion.id} connected`);
  for (const integration of bastion.integrations) {
    console.log(`  ${integration.id}: ${integration.tools.length} tools`);
  }
};

server.onBastionDisconnected = (bastion) => {
  console.log(`bastion ${bastion.id} disconnected`);
};

await server.start();
console.log("listening on ws://localhost:8080");
