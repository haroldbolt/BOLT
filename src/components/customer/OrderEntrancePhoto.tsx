import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { driverSession } from "../../lib/dispatchClient";
import {
  pendingEntrancePhoto,
  sendPendingEntrancePhoto,
} from "../../lib/entrancePhotos";
export function OrderEntrancePhoto({
  orderId,
  dispatchId,
  audience = "customer",
}: {
  orderId: string;
  dispatchId?: string;
  audience?: "customer" | "admin" | "driver";
}) {
  const [url, setUrl] = useState(""),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true,
      local = "";
    setUrl("");
    setMessage("");
    setPending(false);
    const load = async () => {
      const queued =
        audience === "customer"
          ? await pendingEntrancePhoto(orderId)
          : undefined;
      if (active) setPending(!!queued);
      try {
        const blob = await api.getEntrancePhoto(
          orderId,
          audience,
          dispatchId,
          audience === "driver" ? driverSession.get() : undefined,
        );
        if (active && blob) {
          local = URL.createObjectURL(blob);
          setUrl(local);
          setPending(false);
        }
      } catch {
        if (active)
          setMessage("No pudimos cargar la foto. Puedes volver a intentar.");
      }
    };
    void load();
    return () => {
      active = false;
      if (local) URL.revokeObjectURL(local);
    };
  }, [orderId, dispatchId, audience, revision]);
  const retry = async () => {
    setBusy(true);
    try {
      await sendPendingEntrancePhoto(orderId);
      setRevision((n) => n + 1);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // A retry is explicit or once on entry, never another order submission.
  useEffect(() => {
    if (audience !== "customer") return;
    let active = true;
    void sendPendingEntrancePhoto(orderId)
      .then((sent) => {
        if (active && sent) setRevision((n) => n + 1);
      })
      .catch(() => {
        if (active) {
          setPending(true);
          setMessage(
            "Tu pedido está confirmado. La foto quedó pendiente de envío.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [orderId, audience]);
  if (!url && !pending && !message) return null;
  return (
    <section
      aria-label="Referencia de entrega"
      className="my-3 p-3 rounded-xl border border-slate-200 bg-white text-slate-800 space-y-2"
    >
      <h3 className="text-sm font-bold">Foto de la entrada</h3>
      {url && (
        <img
          src={url}
          onError={() => {
            setUrl("");
            setMessage("No pudimos mostrar la foto. Puedes volver a cargarla.");
          }}
          alt="Entrada indicada por el cliente para este pedido"
          className="w-full max-h-64 object-contain rounded-lg"
        />
      )}
      {url && (
        <p className="text-xs text-slate-500">
          Referencia proporcionada por el cliente. Confirma también la dirección
          y las instrucciones.
        </p>
      )}
      {message && (
        <p role="status" className="text-xs text-amber-800">
          {message}
        </p>
      )}
      {pending && (
        <button
          disabled={busy}
          onClick={() => void retry()}
          className="min-h-11 text-sm font-bold text-red-700 underline"
        >
          {busy ? "Enviando foto…" : "Reintentar envío de la foto"}
        </button>
      )}
      {!pending && message && (
        <button
          onClick={() => setRevision((n) => n + 1)}
          className="min-h-11 text-sm underline"
        >
          Volver a cargar foto
        </button>
      )}
    </section>
  );
}
