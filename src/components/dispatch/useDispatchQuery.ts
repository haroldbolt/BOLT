import { useCallback, useEffect, useRef, useState } from "react";
export function useDispatchQuery<T>(
  load: () => Promise<T>,
  enabled = true,
  period = 3000,
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(enabled);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++version.current;
    try {
      const value = await load();
      if (id === version.current) {
        setData(value);
        setError("");
      }
    } catch (e: any) {
      if (id === version.current) {
        setError(e.message || "No se pudo actualizar");
        if (e.status === 401 || e.status === 403) setData(null);
      }
    } finally {
      if (id === version.current) setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    const timer = setInterval(() => void refresh(), period);
    return () => {
      ++version.current;
      clearInterval(timer);
    };
  }, [refresh, enabled, period]);
  return { data, error, loading, refresh };
}
export function useDispatchAction(refresh: () => Promise<unknown>) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const run = async (
    action: () => Promise<unknown>,
    message = "Cambio guardado",
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(message);
    } catch (e: any) {
      setError(e.message || "No se pudo completar la operación");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { run, busy, error, notice };
}
