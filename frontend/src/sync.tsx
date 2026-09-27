import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, API_URL, ApiError, IS_LOCAL, type GarminStatus } from "./api";

export type Notice = { kind: "info" | "warning" | "error"; content: ReactNode };

type SyncState = {
  status: GarminStatus | null;
  syncing: boolean;
  /** Increments after each sync that imported activities: pages refetch when it changes. */
  version: number;
  notice: Notice | null;
  setNotice: (notice: Notice | null) => void;
  sync: () => Promise<void>;
};

const SyncContext = createContext<SyncState | null>(null);

const reconnectNotice: Notice = {
  kind: "warning",
  content: IS_LOCAL ? (
    <>
      Garmin isn't connected to your local app. In VS Code, run the debug configuration{" "}
      <strong>Check Garmin connector + connect local app</strong>, then click Refresh.
    </>
  ) : (
    <>
      Garmin isn't connected. On your PC, in <code>backend/</code>, run{" "}
      <code>uv run python scripts/garmin_login.py --api {API_URL}</code>
    </>
  ),
};

export function errorNotice(err: unknown): Notice {
  if (err instanceof ApiError) {
    if (err.detail === "garmin_not_connected" || err.detail === "garmin_reconnect_needed") return reconnectNotice;
    if (err.status === 429) return { kind: "warning", content: "Garmin is limiting requests. Try again in a few minutes." };
    if (err.status === 0) return { kind: "error", content: "Can't reach the server. Check your connection and try again." };
    return { kind: "error", content: `Something went wrong (${err.detail}).` };
  }
  return { kind: "error", content: "Something went wrong." };
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GarminStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const started = useRef(false);

  const runSync = useCallback(async (automatic: boolean) => {
    setSyncing(true);
    try {
      const { imported, gear_changed, last_sync_at } = await api.sync();
      setStatus((s) => (s ? { ...s, last_sync_at } : s));
      // Pages refetch on a version bump: new activities, or gear that changed on its own.
      if (imported > 0 || gear_changed) setVersion((v) => v + 1);
      if (imported > 0) {
        setNotice({ kind: "info", content: `Imported ${imported} new ${imported === 1 ? "activity" : "activities"}.` });
      } else if (!automatic) {
        setNotice({ kind: "info", content: "Already up to date." });
      }
    } catch (err) {
      if (err instanceof ApiError && (err.detail === "sync_in_progress" || err.status === 401)) return;
      setNotice(errorNotice(err));
    } finally {
      setSyncing(false);
    }
  }, []);

  // Once per visit: read the Garmin status, then pull new activities in the background.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .garminStatus()
      .then((st) => {
        setStatus(st);
        if (st.connected) runSync(true);
        else setNotice(reconnectNotice);
      })
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) setNotice(errorNotice(err));
      });
  }, [runSync]);

  const sync = useCallback(() => runSync(false), [runSync]);

  return (
    <SyncContext.Provider value={{ status, syncing, version, notice, setNotice, sync }}>{children}</SyncContext.Provider>
  );
}

export function useSync(): SyncState {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used inside <SyncProvider>");
  return value;
}
