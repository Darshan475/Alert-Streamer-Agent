"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, apiBaseToWs } from "@/lib/api";
import type { AlertRecord, PipelineStats } from "@/lib/types";

const WS_PATH = "/api/v1/alerts/ws";
const RECONNECT_MS = 3000;

interface StreamSnapshot {
  type: "snapshot";
  alerts: { total: number; items: AlertRecord[] };
  stats: PipelineStats;
}

export function useAlertStream() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [stats, setStats] = useState<PipelineStats | undefined>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = `${apiBaseToWs(API_BASE)}${WS_PATH}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data as string) as StreamSnapshot;
        if (msg.type === "snapshot") {
          setAlerts(msg.alerts.items);
          setStats(msg.stats);
          setHasSnapshot(true);
          setError(null);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setError(new Error("WebSocket connection failed"));
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;
      reconnectRef.current = setTimeout(connect, RECONNECT_MS);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    const heartbeat = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send("ping");
      }
    }, 25000);

    return () => {
      mountedRef.current = false;
      clearInterval(heartbeat);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const reconnect = useCallback(() => {
    wsRef.current?.close();
    connect();
  }, [connect]);

  return {
    alerts,
    stats,
    connected,
    error,
    hasSnapshot,
    isLoading: !hasSnapshot && !error,
    reconnect,
  };
}
