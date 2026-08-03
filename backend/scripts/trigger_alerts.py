#!/usr/bin/env python3
"""Send dummy alerts to the Alert Streamer API for local testing."""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

API_URL = os.getenv("API_URL", "http://localhost:8000")
API_KEY = os.getenv("ALERT_STREAMER_API_KEY", "dev-secret-change-in-production")
DATA_FILE = Path(__file__).parent.parent.parent / "data" / "dummy_alerts.json"


async def send_alerts(file_path: Path, delay_ms: int = 500, api_url: str = API_URL) -> None:
    if not file_path.exists():
        print(f"Data file not found: {file_path}")
        print("Run: python scripts/generate_dummy_alerts.py")
        sys.exit(1)

    with open(file_path, encoding="utf-8") as f:
        data = json.load(f)

    alerts = data.get("alerts", data if isinstance(data, list) else [])
    headers = {"X-API-Key": API_KEY, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        health = await client.get(f"{api_url}/health")
        print(f"Health: {health.json()}")

        for i, alert in enumerate(alerts, 1):
            resp = await client.post(
                f"{api_url}/api/v1/alerts/ingest",
                headers=headers,
                json=alert,
            )
            body = resp.json()
            status = "ACCEPTED" if body.get("accepted") else body.get("status", "rejected").upper()
            print(f"[{i}/{len(alerts)}] {alert['title'][:50]}... -> {status}: {body.get('message', '')}")
            if delay_ms:
                await asyncio.sleep(delay_ms / 1000)

        stats = await client.get(f"{api_url}/api/v1/alerts/stats")
        print("\nPipeline stats:", json.dumps(stats.json(), indent=2))


def main():
    parser = argparse.ArgumentParser(description="Trigger dummy alerts against local API")
    parser.add_argument("-f", "--file", type=str, default=str(DATA_FILE))
    parser.add_argument("-d", "--delay", type=int, default=500, help="Delay between alerts (ms)")
    parser.add_argument("--url", type=str, default=API_URL)
    args = parser.parse_args()

    asyncio.run(send_alerts(Path(args.file), args.delay, args.url))


if __name__ == "__main__":
    main()
