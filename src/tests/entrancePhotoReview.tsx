/** Explicit, isolated review page. Never imported by the production application. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AddressConfirmationModal } from "../components/customer/AddressConfirmationModal";
import { SavedAddressesModal } from "../components/customer/SavedAddressesModal";
import { CheckoutModal } from "../components/customer/CheckoutModal";
import { OrderTracking } from "../components/customer/OrderTracking";
import { GuestAddressStore } from "../lib/guestAddresses";
import { api } from "../lib/api";
import fixtures from "./municipal-coverage-fixtures.json";
import cedritos from "./coverage-address-fixtures.json";
const book = new GuestAddressStore({
  getItem: () => localStorage.getItem("bolt_photo_review_addresses"),
  setItem: (_k, v) => localStorage.setItem("bolt_photo_review_addresses", v),
});
const places = [
  cedritos[0],
  fixtures.find((f) => f.name === "Chía") ||
    cedritos.find((f) => f.name === "Chia"),
  fixtures.find((f) => f.name === "Cajicá"),
  fixtures.find((f) => f.name === "Cota"),
].filter(Boolean) as any[];
let chosen = 0;
Object.defineProperty(navigator, "geolocation", {
  configurable: true,
  value: {
    getCurrentPosition(success: PositionCallback) {
      const f = places[chosen];
      queueMicrotask(() =>
        success({
          coords: {
            latitude: f.coordinates.lat,
            longitude: f.coordinates.lng,
            accuracy: 12,
          },
          timestamp: Date.now(),
        } as GeolocationPosition),
      );
    },
  },
});
api.reverseGeocode = async (lat, lng) => {
  const f = places.find(
    (f) => f.coordinates.lat === lat && f.coordinates.lng === lng,
  );
  return f
    ? {
        address: f.formattedAddress || f.address,
        municipality: f.municipality || f.name,
        locality: f.locality,
        neighborhood: f.name === "Cedritos" ? "Cedritos" : undefined,
      }
    : null;
};
function Review() {
  const [snapshot, setSnapshot] = useState(book.getSnapshot()),
    [open, setOpen] = useState(false),
    [savedOpen, setSavedOpen] = useState(false),
    [editing, setEditing] = useState<any>(),
    [quote, setQuote] = useState<any>(null),
    [stores, setStores] = useState<any[]>([]),
    [products, setProducts] = useState<any[]>([]),
    [checkout, setCheckout] = useState(false),
    [orderId, setOrderId] = useState(
      sessionStorage.getItem("bolt_photo_review_order") || "",
    ),
    [status, setStatus] = useState(""),
    [window, setWindow] = useState<any>(null);
  useEffect(() => book.subscribe(() => setSnapshot(book.getSnapshot())), []);
  useEffect(() => {
    void Promise.all([api.getStores(), api.getCatalog()]).then(([s, p]) => {
      setStores(s);
      setProducts(p);
    });
  }, []);
  const product = products.find((p) => p.id === "SIM-FOOD-20KG"),
    cart = product ? [{ product, quantity: 1 }] : [];
  useEffect(() => {
    let active = true;
    setQuote(null);
    if (snapshot.current && product)
      void api
        .getDeliveryQuote({
          destination: snapshot.current,
          items: [{ productId: product.id, quantity: 1 }],
          requestedMode: "PROGRAMADO",
          scheduledWindow: window || undefined,
        })
        .then((q) => {
          if (active) setQuote(q);
        });
    return () => {
      active = false;
    };
  }, [snapshot.selectionRevision, product, window]);
  const current = snapshot.current;
  if (orderId)
    return (
      <>
        <div className="p-3 bg-amber-100 text-sm">
          SIMULACIÓN AISLADA · pedido y foto de prueba ·{" "}
          <button
            onClick={() => {
              sessionStorage.removeItem("bolt_photo_review_order");
              setOrderId("");
            }}
            className="underline"
          >
            Volver a probar direcciones
          </button>
        </div>
        <OrderTracking
          orderId={orderId}
          guestOnly
          onBack={() => setOrderId("")}
        />
      </>
    );
  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4 text-slate-900">
      <h1 className="text-2xl font-black">BOLT · Prueba de foto de entrada</h1>
      <p className="bg-amber-100 p-3 rounded-xl text-sm">
        SIMULACIÓN: GPS de fixtures identificados y compra ficticia. No realiza
        entregas ni cobros reales.
      </p>
      <label className="block">
        Destino GPS de prueba{" "}
        <select
          aria-label="Destino GPS de prueba"
          defaultValue="0"
          onChange={(e) => {
            chosen = Number(e.target.value);
          }}
          className="border p-2"
        >
          {places.map((f, i) => (
            <option value={i} key={i}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() => {
          setEditing(undefined);
          setOpen(true);
        }}
        className="min-h-11 rounded-xl px-4 bg-red-600 text-white"
      >
        Agregar dirección con foto
      </button>{" "}
      <button
        onClick={() => setSavedOpen(true)}
        className="min-h-11 px-4 border rounded-xl"
      >
        Mis direcciones de prueba
      </button>
      <p role="status">{status}</p>
      {current && (
        <div className="border rounded-xl p-4">
          <p>Dirección confirmada: {current.address}</p>
          <p>
            Foto:{" "}
            {current.referencePhotoId
              ? "guardada en este dispositivo"
              : "sin foto"}
          </p>
          <p>{quote?.message || "Validando…"}</p>
          <button
            onClick={() => setCheckout(true)}
            disabled={!quote?.basketValidated}
            className="min-h-11 px-4 bg-red-600 text-white rounded-xl disabled:bg-slate-300"
          >
            Revisar compra de prueba
          </button>
        </div>
      )}
      <AddressConfirmationModal
        isOpen={open}
        onClose={() => setOpen(false)}
        currentAddress={editing?.address || ""}
        currentDetails={editing?.details || ""}
        currentCoordinates={editing?.coordinates}
        currentTerritory={editing}
        currentPhotoId={editing?.referencePhotoId}
        savedAddressOptions={editing}
        stores={stores}
        products={products}
        cartItems={cart}
        onConfirmAddress={(address, details, coordinates, q, m) => {
          const d = {
            address,
            details,
            coordinates,
            municipality: q.municipality,
            locality: q.locality,
            neighborhood: q.destination.neighborhood,
            referencePhotoId: m?.referencePhotoId,
          };
          if (editing) book.update(editing.id, d, m!.name, m!.isDefault);
          else {
            book.confirm(d);
            if (m?.saveAddress) book.saveCurrent(m.name, m.isDefault);
          }
          setStatus(
            "Dirección confirmada; ningún pedido creado por confirmar el destino.",
          );
          return true;
        }}
      />
      <SavedAddressesModal
        isOpen={savedOpen}
        onClose={() => setSavedOpen(false)}
        addresses={snapshot.addresses}
        current={current}
        quote={quote}
        warning={snapshot.warning}
        message=""
        onAdd={() => {
          setSavedOpen(false);
          setEditing(undefined);
          setOpen(true);
        }}
        onEdit={(a) => {
          setEditing(a);
          setSavedOpen(false);
          setOpen(true);
        }}
        onUse={(id) => book.select(id)}
        onRemove={(id) => book.remove(id)}
        onDefault={(id) => book.setDefault(id)}
        onSave={(name, def) => book.saveCurrent(name, def).ok}
        onContinue={() => setSavedOpen(false)}
      />
      <CheckoutModal
        isOpen={checkout}
        onClose={() => setCheckout(false)}
        cartItems={cart}
        currentStore={
          stores.find((s) => s.id === quote?.assignedStoreId) || null
        }
        customerAddress={current?.address}
        customerAddressDetails={current?.details}
        customerCoordinates={current?.coordinates}
        referencePhotoId={current?.referencePhotoId}
        deliveryQuote={quote}
        selectedMode="PROGRAMADO"
        selectedScheduledWindow={window}
        onSelectScheduledWindow={setWindow}
        onRefreshCatalog={() => void api.getCatalog().then(setProducts)}
        onOrderSuccess={(id) => {
          sessionStorage.setItem("bolt_photo_review_order", id);
          setOrderId(id);
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
