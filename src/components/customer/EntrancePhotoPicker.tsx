import React, { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import {
  getEntrancePhoto,
  prepareEntrancePhoto,
  saveEntrancePhoto,
} from "../../lib/entrancePhotos";
export function EntrancePhotoPreview({ photoId }: { photoId?: string }) {
  const [url, setUrl] = useState(""),
    [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true,
      local = "";
    setUrl("");
    setMissing(false);
    if (photoId)
      void getEntrancePhoto(photoId).then((p) => {
        if (alive) {
          if (p) {
            local = URL.createObjectURL(p.blob);
            setUrl(local);
          } else setMissing(true);
        }
      });
    return () => {
      alive = false;
      if (local) URL.revokeObjectURL(local);
    };
  }, [photoId]);
  return url ? (
    <img
      src={url}
      onError={() => {
        setUrl("");
        setMissing(true);
      }}
      alt="Foto de referencia de la entrada"
      className="max-h-40 w-full object-contain rounded-xl bg-slate-50"
    />
  ) : missing ? (
    <p role="status" className="text-xs text-amber-800">
      La foto no está disponible en este dispositivo. Puedes agregar otra o
      continuar sin foto.
    </p>
  ) : null;
}
export function EntrancePhotoPicker({
  photoId,
  onChange,
  disabled = false,
}: {
  photoId?: string;
  onChange: (id?: string) => void;
  disabled?: boolean;
}) {
  const camera = useRef<HTMLInputElement>(null),
    gallery = useRef<HTMLInputElement>(null),
    version = useRef(0);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(
    () => () => {
      ++version.current;
    },
    [],
  );
  useEffect(() => {
    ++version.current;
    setBusy(false);
  }, [disabled]);
  const choose = async (file?: File) => {
    if (!file) return;
    const current = ++version.current;
    setBusy(true);
    setMessage("");
    try {
      const blob = await prepareEntrancePhoto(file);
      if (current !== version.current) return;
      const result = await saveEntrancePhoto(blob);
      if (current === version.current) {
        onChange(result.photo.id);
        setMessage(result.warning);
      }
    } catch (e) {
      if (current === version.current)
        setMessage((e as Error).message + " Puedes continuar sin foto.");
    } finally {
      if (current === version.current) setBusy(false);
    }
  };
  const input = (capture: boolean) => (
    <input
      ref={capture ? camera : gallery}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
      capture={capture ? "environment" : undefined}
      className="sr-only"
      tabIndex={-1}
      aria-label={
        capture ? "Tomar foto de la entrada" : "Elegir foto de la entrada"
      }
      onChange={(e) => {
        void choose(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );
  return (
    <section
      aria-label="Foto opcional de la entrada"
      className="rounded-2xl border border-slate-200 p-3 space-y-2"
    >
      <h4 className="font-bold text-sm text-slate-900">
        Foto de la entrada{" "}
        <span className="font-normal text-slate-500">(opcional)</span>
      </h4>
      <p className="text-xs text-slate-600">
        Ayuda a reconocer la puerta o portería. Evita incluir personas o
        documentos. Se compartirá con administración y el repartidor asignado al
        confirmar tu pedido.
      </p>
      {photoId && <EntrancePhotoPreview photoId={photoId} />}
      <div className="flex flex-wrap gap-2">
        {input(true)}
        {input(false)}
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => camera.current?.click()}
          className="min-h-11 px-3 rounded-xl bg-red-50 text-red-700 text-xs font-bold disabled:opacity-50 flex items-center gap-2"
        >
          <Camera size={16} />
          Tomar foto
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => gallery.current?.click()}
          className="min-h-11 px-3 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold disabled:opacity-50 flex items-center gap-2"
        >
          <ImagePlus size={16} />
          {photoId ? "Cambiar foto" : "Elegir foto"}
        </button>
        {photoId && (
          <button
            type="button"
            onClick={() => {
              ++version.current;
              setBusy(false);
              setMessage("");
              onChange(undefined);
            }}
            className="min-h-11 px-3 text-xs underline flex items-center gap-1"
          >
            <Trash2 size={16} />
            Quitar foto
          </button>
        )}
      </div>
      {!disabled && (
        <p className="text-xs text-slate-500">
          La foto no reemplaza la dirección ni el punto del mapa.
        </p>
      )}
      {disabled && (
        <p className="text-xs text-slate-500">
          Primero ubica el destino en el mapa.
        </p>
      )}
      {(busy || message) && (
        <p role="status" className="text-xs text-amber-800">
          {busy ? "Preparando foto… Puedes continuar sin esperar." : message}
        </p>
      )}
    </section>
  );
}
