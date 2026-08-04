#!/usr/bin/env python3
"""Trigger alerts via the agent API."""

import argparse
import asyncio
import os

import httpx

API_BASE = os.environ.get("ALERT_STREAMER_API", "http://localhost:8000")
API_KEY = os.environ.get("ALERT_STREAMER_API_KEY", "dev-secret-change-in-production")


async def generate_one(client: httpx.AsyncClient, hint: str | None) -> None:
    r = await client.post(
        f"{API_BASE}/api/v1/agents/generate-alert",
        json={"hint": hint},
        headers={"X-API-Key": API_KEY},
    )
    r.raise_for_status()
    data = r.json()
    ingest = data.get("ingest", {})
    print(f"  {'✓' if ingest.get('accepted') else '✗'} {data.get('alert', {}).get('title', '?')} — {ingest.get('message', '')}")


async def main(count: int, hint: str | None, delay: float) -> None:
    print(f"Agent-generating {count} alert(s) → {API_BASE}")
    async with httpx.AsyncClient(timeout=120.0) as client:
        for i in range(count):
            await generate_one(client, hint)
            if delay > 0 and i < count - 1:
                await asyncio.sleep(delay)
    print("Done.")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Trigger agent-generated alerts")
    p.add_argument("-n", "--count", type=int, default=5)
    p.add_argument("--hint", type=str, default=None)
    p.add_argument("--delay", type=float, default=0.6)
    args = p.parse_args()
    asyncio.run(main(args.count, args.hint, args.delay))
