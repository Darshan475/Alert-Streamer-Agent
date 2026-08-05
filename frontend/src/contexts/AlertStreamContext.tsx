"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ALERT_STREAM_SNAPSHOT_EVENT,
  API_BASE,
  apiBaseToWs,
  getAlerts,
  getStats,
} from "@/lib/api";
import { loadAlertSnapshot, mergeSnapshots, saveAlertSnapshot } from "@/lib/alertSnapshotCache";
import type { AlertRecord, PipelineStats, StreamSnapshot } from "@/lib/types";

const WS_PATH = "/api/v1/alerts/ws";
const RECONNECT_MS = 5000;

interface AlertStreamContextValue {
  alerts: AlertRecord[];
  stats: PipelineStats | undefined;
  connected: boolean;
  error: Error | null;
  hasSnapshot: boolean;
  isLoading: boolean;
  reconnect: () => void;
  applySnapshot: (snapshot: StreamSnapshot) => void;
}

const AlertStreamContext = createContext<AlertStreamContextValue | null>(null);

export function AlertStreamProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [stats, setStats] = useState<PipelineStats | undefined>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const bootstrappedRef = useRef(false);

  const applySnapshot = useCallback((snapshot: StreamSnapshot) => {
    if (snapshot.type !== "snapshot") return;
    setAlerts((prev) => {
      const merged = mergeSnapshots(
        prev.length > 0
          ? { type: "snapshot", alerts: { total: prev.length, items: prev }, stats: snapshot.stats }
          : loadAlertSnapshot(),
        snapshot
      );
      setStats(merged.stats);
      saveAlertSnapshot(merged);
      return merged.alerts.items;
    });
    setHasSnapshot(true);
    setError(null);
  }, []);

  const applyItems = useCallback((items: AlertRecord[], nextStats: PipelineStats) => {
    setAlerts(items);
    setStats(nextStats);
    setHasSnapshot(true);
    setError(null);
    saveAlertSnapshot({
      type: "snapshot",
      alerts: { total: items.length, items },
      stats: nextStats,
    });
  }, []);

  useEffect(() => {
    const cached = loadAlertSnapshot();
    if (cached) applySnapshot(cached);
  }, [applySnapshot]);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    Promise.all([getAlerts({ limit: 100, include_duplicates: true }), getStats()])
      .then(([list, nextStats]) => {
        if (!mountedRef.current) return;
        const cached = loadAlertSnapshot();
        if (cached && cached.alerts.items.length >= list.items.length) {
          applySnapshot(cached);
        } else {
          applyItems(list.items, nextStats);
        }
      })
      .catch(() => {
        /* WebSocket will retry */
      });
  }, [applyItems, applySnapshot]);

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
          const cached = loadAlertSnapshot();
          applySnapshot(mergeSnapshots(cached, msg));
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
      if (detail?.type === "snapshot") applySnapshot(detail);
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

  return (
    <AlertStreamContext.Provider
      value={{
        alerts,
        stats,
        connected,
        error,
        hasSnapshot,
        isLoading: !hasSnapshot,
        reconnect,
        applySnapshot,
      }}
    >
      {children}
    </AlertStreamContext.Provider>
  );
}

export function useAlertStream() {
  const ctx = useContext(AlertStreamContext);
  if (!ctx) throw new Error("useAlertStream must be used within AlertStreamProvider");
  return ctx;
}
