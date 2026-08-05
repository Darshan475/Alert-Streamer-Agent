import type { AlertIngest, AlertRecord } from "./types";

const SERVICE_PATTERN =
  /(digitalpromosmiscservices|propertyupdate|whgservices)[\w\-./]*/gi;
const PATH_PATTERN = /\/whgservices\/[\w./-]+/gi;

function maskToken(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes("digitalpromos")) return "svc-***-prd";
  if (lower.includes("propertyupdate")) return "queue-***";
  if (lower.includes("whgservices")) return "whgservices";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function maskText(text: string): string {
  if (!text) return text;
  return text
    .replace(PATH_PATTERN, "/whgservices/***")
    .replace(SERVICE_PATTERN, (m) => maskToken(m));
}

export function maskIncidentId(id: string | undefined | null): string {
  if (!id) return "—";
  const s = String(id);
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}

export function maskIngestForDisplay(alert: AlertIngest): AlertIngest {
  return {
    ...alert,
    title: maskText(alert.title),
    description: maskText(alert.description),
    service: maskToken(alert.service),
    hostname: alert.hostname ? "host-***" : alert.hostname,
    pod_name: alert.pod_name ? "pod-***" : alert.pod_name,
    metadata: {
      ...alert.metadata,
      incident_id: maskIncidentId(String(alert.metadata?.incident_id ?? "")),
    },
  };
}

export function maskRecordForDisplay(alert: AlertRecord): AlertRecord {
  return {
    ...alert,
    title: maskText(alert.title),
    description: maskText(alert.description),
    service: maskToken(alert.service),
    hostname: alert.hostname ? "host-***" : alert.hostname,
    pod_name: alert.pod_name ? "pod-***" : alert.pod_name,
    metadata: {
      ...alert.metadata,
      incident_id: maskIncidentId(String(alert.metadata?.incident_id ?? "")),
    },
  };
}
