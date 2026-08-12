"""Minimal Journal Bastion client server (Python).

    pip install -e clients/python   # unpublished; install from source
    python hub_server.py

Then point a bastion at ws://localhost:8080 with token "gw_demo":

    JOURNAL_BASTION_TOKEN=gw_demo \\
    JOURNAL_BASTION_URL=ws://localhost:8080 \\
    journal-bastion --config bastion.json
"""

import asyncio

from journal_bastion_hub import BastionServer, TokenValidationResult


async def validate_token(token: str) -> TokenValidationResult | None:
    if token == "gw_demo":
        return TokenValidationResult(organization_id="org_demo")
    return None


def on_connected(bastion) -> None:
    print(f"bastion {bastion.id} connected")
    for integration in bastion.integrations:
        print(f"  {integration.id}: {len(integration.tools)} tools")


async def main() -> None:
    server = BastionServer(validate_token=validate_token, port=8080)
    server.on_bastion_connected = on_connected
    server.on_bastion_disconnected = lambda gw: print(f"bastion {gw.id} disconnected")

    await server.start()
    print("listening on ws://localhost:8080")
    await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
