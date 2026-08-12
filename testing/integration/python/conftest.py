import asyncio
import os
import subprocess

import pytest_asyncio

from journal_bastion_client import BastionServer, TokenValidationResult

BASTION_BIN = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "bastion", "dist", "main.js"
)


async def _validate_token(token: str) -> TokenValidationResult | None:
    if token == "gw_test":
        return TokenValidationResult(organization_id="org_1")
    return None


@pytest_asyncio.fixture
async def server_and_bastion():
    """Start Python client server + real TS bastion."""
    server = BastionServer(validate_token=_validate_token, port=0, ping_interval=0)
    await server.start()

    proc = subprocess.Popen(
        ["node", BASTION_BIN],
        env={
            **os.environ,
            "JOURNAL_BASTION_TOKEN": "gw_test",
            "JOURNAL_BASTION_URL": server.url,
            "JOURNAL_BASTION_CONFIG": "{}",
            "LOG_LEVEL": "error",
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Wait for bastion to connect (up to 10s)
    for _ in range(100):
        if server.connected_bastions:
            break
        await asyncio.sleep(0.1)

    yield server

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    await server.stop()
