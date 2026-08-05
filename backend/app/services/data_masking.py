"""Mask sensitive service / endpoint names in alert payloads for demo display."""

import re
from copy import deepcopy
from typing import Any

from app.models.schemas import AlertIngest, AlertRecord

_SERVICE_PATTERN = re.compile(
    r"(digitalpromosmiscservices|propertyupdate|whgservices)[\w\-./]*",
    re.I,
)
_PATH_PATTERN = re.compile(r"/whgservices/[\w./\-]+", re.I)
_HOST_PATTERN = re.compile(r"\b[\w-]+\.(internal|local|corp|prd)\b", re.I)


def mask_text(text: str) -> str:
    if not text:
        return text
    masked = _PATH_PATTERN.sub("/whgservices/***", text)
    masked = _SERVICE_PATTERN.sub(lambda m: _mask_token(m.group(0)), masked)
    masked = _HOST_PATTERN.sub("host-***.prd", masked)
    return masked


def _mask_token(value: str) -> str:
    lower = value.lower()
    if "digitalpromos" in lower:
        return "svc-***-prd"
    if "propertyupdate" in lower:
        return "queue-***"
    if "whgservices" in lower:
        return "whgservices"
    if len(value) <= 4:
        return "****"
    return f"{value[:2]}***{value[-2:]}"


def mask_ingest(alert: AlertIngest) -> AlertIngest:
    data = alert.model_dump()
    data["title"] = mask_text(str(data.get("title", "")))
    data["description"] = mask_text(str(data.get("description", "")))
    data["service"] = _mask_token(str(data.get("service", "")))
    if data.get("hostname"):
        data["hostname"] = "host-***"
    if data.get("pod_name"):
        data["pod_name"] = "pod-***"
    return AlertIngest.model_validate(data)


def mask_record(record: AlertRecord) -> AlertRecord:
    data = record.model_dump()
    data["title"] = mask_text(str(data.get("title", "")))
    data["description"] = mask_text(str(data.get("description", "")))
    data["service"] = _mask_token(str(data.get("service", "")))
    if data.get("hostname"):
        data["hostname"] = "host-***"
    if data.get("pod_name"):
        data["pod_name"] = "pod-***"
    meta: dict[str, Any] = dict(data.get("metadata") or {})
    if meta.get("incident_id"):
        iid = str(meta["incident_id"])
        meta["incident_id"] = f"{iid[:2]}***{iid[-2:]}" if len(iid) > 4 else "****"
    data["metadata"] = meta
    return AlertRecord.model_validate(data)
