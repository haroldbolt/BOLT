import React from "react";
import { dispatchLabels } from "../../lib/dispatchClient";
export const control =
  "min-h-11 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm font-bold disabled:opacity-40 hover:bg-slate-50";
export const primary =
  control + " !bg-red-600 !text-white !border-red-600 hover:!bg-red-700";
export const field =
  "w-full min-h-11 rounded-xl border border-slate-300 p-3 bg-white text-slate-900";
export function Status({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${["DELIVERED", "AVAILABLE"].includes(value) ? "bg-emerald-100 text-emerald-800" : ["INCIDENT", "SEARCH_EXHAUSTED", "REQUIERE_ATENCION", "UNKNOWN"].includes(value) ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}
    >
      {dispatchLabels[value] || value}
    </span>
  );
}
export function Feedback({
  error,
  notice,
}: {
  error?: string;
  notice?: string;
}) {
  return (
    <>
      {error && (
        <p
          role="alert"
          className="bg-rose-50 text-rose-800 p-3 rounded-xl text-sm"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="bg-blue-50 text-blue-900 p-3 rounded-xl text-sm"
        >
          {notice}
        </p>
      )}
    </>
  );
}
export function SimulationBanner() {
  return (
    <div className="bg-amber-100 text-amber-950 border-b border-amber-300 px-4 py-3 text-sm">
      <strong>SIMULACIÓN · Datos ficticios.</strong> Sin pedidos reales, cobros
      ni servicios externos.{" "}
      <a className="underline font-bold" href="/simulacion">
        Abrir centro de pruebas
      </a>
    </div>
  );
}
