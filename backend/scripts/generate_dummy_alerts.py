#!/usr/bin/env python3
"""Generate realistic dummy alerts for local testing."""

import argparse
import json
import random
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

ALERT_TEMPLATES = [
    {
        "alert_type": "cpu_high",
        "title": "CPU usage exceeds 95% on production nodes",
        "description": "Sustained CPU utilization above 95% for 5+ minutes on api-gateway pods.",
        "severity": "critical",
        "service": "api-gateway",
        "metric_value": 97.3,
        "threshold": 95.0,
        "tags": ["cpu", "performance", "production"],
    },
    {
        "alert_type": "memory_leak",
        "title": "Memory leak detected in order-processor",
        "description": "Heap usage growing 12% per hour without traffic increase. Possible memory leak in cache layer.",
        "severity": "high",
        "service": "order-processor",
        "metric_value": 89.1,
        "threshold": 80.0,
        "tags": ["memory", "leak", "jvm"],
    },
    {
        "alert_type": "disk_full",
        "title": "Disk usage critical on logging node",
        "description": "Root volume at 98% capacity on log-aggregator-03. Log rotation may have failed.",
        "severity": "critical",
        "service": "log-aggregator",
        "metric_value": 98.2,
        "threshold": 90.0,
        "tags": ["disk", "storage", "logging"],
    },
    {
        "alert_type": "pod_crash",
        "title": "Pod crash loop in payment namespace",
        "description": "payment-worker-7f8d9c CrashLoopBackOff — container exiting with code 137 (OOMKilled).",
        "severity": "critical",
        "service": "payment-worker",
        "metric_value": 5,
        "threshold": 1,
        "tags": ["kubernetes", "pod", "crash"],
    },
    {
        "alert_type": "database_timeout",
        "title": "Database connection timeout spike",
        "description": "PostgreSQL connection pool exhausted. 847 queries timing out after 30s on primary replica.",
        "severity": "high",
        "service": "postgres-primary",
        "metric_value": 847,
        "threshold": 50,
        "tags": ["database", "postgres", "timeout"],
    },
    {
        "alert_type": "api_latency",
        "title": "API latency P99 above SLA",
        "description": "Checkout API P99 latency at 4.2s (SLA: 500ms). Upstream inventory service degraded.",
        "severity": "high",
        "service": "checkout-api",
        "metric_value": 4200,
        "threshold": 500,
        "tags": ["latency", "api", "sla"],
    },
    {
        "alert_type": "ssl_certificate_expiring",
        "title": "SSL certificate expiring in 7 days",
        "description": "TLS cert for api.example.com expires on 2026-08-10. Auto-renewal failed last attempt.",
        "severity": "medium",
        "service": "ingress-controller",
        "metric_value": 7,
        "threshold": 14,
        "tags": ["ssl", "security", "certificate"],
    },
    {
        "alert_type": "kubernetes_node_down",
        "title": "Kubernetes node NotReady",
        "description": "Node gke-prod-pool-4 is NotReady for 3 minutes. 12 pods evicted.",
        "severity": "critical",
        "service": "gke-cluster-prod",
        "metric_value": 1,
        "threshold": 0,
        "tags": ["kubernetes", "node", "infra"],
    },
    {
        "alert_type": "high_error_rate",
        "title": "High 5xx error rate on user-service",
        "description": "Error rate at 18.4% (baseline 0.3%). Correlates with recent deployment v2.14.0.",
        "severity": "critical",
        "service": "user-service",
        "metric_value": 18.4,
        "threshold": 5.0,
        "tags": ["errors", "5xx", "deployment"],
    },
    {
        "alert_type": "payment_service_unavailable",
        "title": "Payment service unavailable",
        "description": "Stripe webhook handler returning 503. Payment processing halted for EU region.",
        "severity": "critical",
        "service": "payment-gateway",
        "metric_value": 100,
        "threshold": 1,
        "tags": ["payment", "availability", "revenue"],
    },
]

ENVIRONMENTS = ["production", "staging", "production-eu"]
REGIONS = ["us-east-1", "eu-west-1", "ap-southeast-1"]
NAMESPACES = ["default", "payments", "platform", "monitoring"]
SOURCES = ["prometheus", "datadog", "grafana", "cloudwatch", "pagerduty"]


def generate_alert(template: dict, index: int, include_duplicate: bool = False) -> dict:
    env = random.choice(ENVIRONMENTS)
    region = random.choice(REGIONS)
    namespace = random.choice(NAMESPACES)
    ts = datetime.now(UTC) - timedelta(minutes=random.randint(0, 120))

    alert = {
        "source": random.choice(SOURCES),
        "alert_type": template["alert_type"],
        "title": template["title"],
        "description": template["description"],
        "severity": template["severity"],
        "service": template["service"],
        "environment": env,
        "metric_value": template["metric_value"],
        "threshold": template["threshold"],
        "hostname": f"{template['service']}-{index % 3 + 1}.{region}.internal",
        "namespace": namespace,
        "pod_name": f"{template['service']}-{uuid.uuid4().hex[:8]}",
        "region": region,
        "tags": template["tags"],
        "metadata": {
            "runbook_url": f"https://wiki.internal/runbooks/{template['alert_type']}",
            "dashboard_url": f"https://grafana.internal/d/{template['service']}",
            "incident_id": f"INC-{uuid.uuid4().hex[:6].upper()}",
        },
        "timestamp": ts.isoformat(),
    }

    if include_duplicate:
        # Same fingerprint fields as first alert of same type for dedup testing
        alert["hostname"] = f"{template['service']}-1.{region}.internal"
        alert["namespace"] = "default"

    return alert


def generate_batch(count: int = 10, include_duplicates: bool = True) -> list[dict]:
    alerts = []
    for i, template in enumerate(ALERT_TEMPLATES):
        alerts.append(generate_alert(template, i))

    if include_duplicates and alerts:
        dup = generate_alert(ALERT_TEMPLATES[0], 0, include_duplicate=True)
        alerts.append(dup)

    # Fill remaining with random templates
    while len(alerts) < count:
        template = random.choice(ALERT_TEMPLATES)
        alerts.append(generate_alert(template, len(alerts)))

    return alerts[:count]


def main():
    parser = argparse.ArgumentParser(description="Generate dummy alert JSON")
    parser.add_argument("-n", "--count", type=int, default=12, help="Number of alerts")
    parser.add_argument("-o", "--output", type=str, default="../data/dummy_alerts.json")
    parser.add_argument("--no-duplicates", action="store_true")
    args = parser.parse_args()

    alerts = generate_batch(count=args.count, include_duplicates=not args.no_duplicates)
    output_path = Path(__file__).parent / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"alerts": alerts, "generated_at": datetime.now(UTC).isoformat()}, f, indent=2)

    print(f"Generated {len(alerts)} alerts -> {output_path.resolve()}")


if __name__ == "__main__":
    main()
