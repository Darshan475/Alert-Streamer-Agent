"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, apiBaseToWs, getAlerts, getStats, ALERT_STREAM_SNAPSHOT_EVENT } from "@/lib/api";
import type { AlertRecord, PipelineStats, StreamSnapshot } from "@/lib/types";

const WS_PATH = "/api/v1/alerts/ws";
const RECONNECT_MS = 5000;

interface StreamSnapshotMessage extends StreamSnapshot {}

export function useAlertStream() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [stats, setStats] = useState<PipelineStats | undefined>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const bootstrappedRef = useRef(false);

  const applySnapshot = useCallback((items: AlertRecord[], nextStats: PipelineStats) => {
    setAlerts(items);
    setStats(nextStats);
    setHasSnapshot(true);
    setError(null);
  }, []);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    Promise.all([getAlerts({ limit: 100, include_duplicates: true }), getStats()])
      .then(([list, nextStats]) => {
        if (!mountedRef.current) return;
        applySnapshot(list.items, nextStats);
      })
      .catch(() => {
        /* WebSocket will retry */
      });
  }, [applySnapshot]);

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
        const msg = JSON.parse(event.data as string) as StreamSnapshotMessage;
        if (msg.type === "snapshot") {
          applySnapshot(msg.alerts.items, msg.stats);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      if (!hasSnapshot) setError(new Error("WebSocket connection failed"));
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;
      reconnectRef.current = setTimeout(connect, RECONNECT_MS);
    };
  }, [applySnapshot, hasSnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    const onSnapshot = (event: Event) => {
      const detail = (event as CustomEvent<StreamSnapshot>).detail;
      if (detail?.type === "snapshot") {
        applySnapshot(detail.alerts.items, detail.stats);
      }
    };
    window.addEventListener(ALERT_STREAM_SNAPSHOT_EVENT, onSnapshot);

    const heartbeat = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send("ping");
      }
    }, 30000);

    return () => {
      mountedRef.current = false;
      window.removeEventListener(ALERT_STREAM_SNAPSHOT_EVENT, onSnapshot);
      clearInterval(heartbeat);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, applySnapshot]);

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
    isLoading: !hasSnapshot,
    reconnect,
  };
}
