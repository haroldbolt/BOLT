import React from 'react';
import { Product } from '../../types';
import { X, Scale, Plus, Minus, Check, AlertCircle, ShoppingBag, Trash2, FileText, Snowflake } from 'lucide-react';
import { formatCOP } from '../../lib/formatters';

interface ProductCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  compareProducts: Product[];
  onRemoveProduct: (productId: string) => void;
  onClearAll: () => void;
  cartQuantities: Record<string, number>;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (product: Product, quantity: number) => void;
  selectedStoreId: string;
}

export const ProductCompareModal: React.FC<ProductCompareModalProps> = ({
  isOpen,
  onClose,
  compareProducts,
  onRemoveProduct,
  onClearAll,
  cartQuantities,
  onAddToCart,
  onUpdateQuantity,
  selectedStoreId,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl relative overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-slate-100 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-900 flex items-center justify-center font-black shadow-xs">
              <Scale className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900">
                  Comparador de Productos
                </h2>
                <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full tabular-nums">
                  {compareProducts.length} de 3
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Compara especificaciones técnicas, precios, peso y disponibilidad por sede
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {compareProducts.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 font-semibold rounded-xl transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vaciar</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body / Table Container */}
        <div className="flex-1 overflow-x-auto overflow-y-auto p-4 sm:p-6">
          {compareProducts.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-600 mx-auto flex items-center justify-center">
                <Scale className="w-7 h-7" />
              </div>
              <h3 className="font-extrabold text-slate-800 text-base">No hay productos en el comparador</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Selecciona la opción &quot;Comparar&quot; en cualquier producto del catálogo para verlos frente a frente.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 bg-slate-900 text-white font-bold text-xs rounded-xl shadow-xs hover:bg-slate-800 transition cursor-pointer"
              >
                Explorar catálogo
              </button>
            </div>
          ) : (
            <div className="min-w-[650px] space-y-4">
              {/* Product Header Columns */}
              <div className="grid grid-cols-4 gap-4 pb-4 border-b border-slate-100 items-start">
                <div className="text-xs font-extrabold text-slate-400 uppercase tracking-wider pt-2">
                  Producto
                </div>

                {compareProducts.map((prod) => {
                  const inCartQty = cartQuantities[prod.id] || 0;
                  const stock = prod.stockByStore[selectedStoreId] || 0;
                  const reserved = prod.reservedStockByStore[selectedStoreId] || 0;
                  const available = Math.max(0, stock - reserved);
                  const isOut = available <= 0;

                  return (
                    <div
                      key={prod.id}
                      className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/80 flex flex-col justify-between h-full relative space-y-3"
                    >
                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={() => onRemoveProduct(prod.id)}
                        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 shadow-xs flex items-center justify-center transition cursor-pointer"
                        title="Quitar este producto"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>

                      {/* Image & Brand */}
                      <div className="flex flex-col items-center text-center space-y-2">
                        <img
                          src={prod.image}
                          alt={prod.name}
                          className="w-20 h-20 object-cover rounded-xl bg-white border border-slate-100 p-1"
                        />
                        <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">
                          {prod.brand}
                        </span>
                        <h4 className="text-xs font-black text-slate-900 line-clamp-2 leading-snug">
                          {prod.name}
                        </h4>
                      </div>

                      {/* Pricing */}
                      <div className="text-center pt-1 border-t border-slate-200/60">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="text-base font-black text-slate-900 tabular-nums">
                            {formatCOP(prod.price)}
                          </span>
                          {prod.originalPrice && prod.originalPrice > prod.price && (
                            <span className="text-[11px] text-slate-400 line-through tabular-nums">
                              {formatCOP(prod.originalPrice)}
                            </span>
                          )}
                        </div>
                        {prod.discountPercent && prod.discountPercent > 0 && (
                          <span className="inline-block mt-0.5 text-[10px] font-extrabold bg-amber-400 text-slate-950 px-2 py-0.5 rounded-md">
                            -{prod.discountPercent}% OFF
                          </span>
                        )}
                      </div>

                      {/* Add to cart / Quantity controller */}
                      <div className="pt-2">
                        {isOut ? (
                          <div className="w-full py-2 bg-slate-200 text-slate-500 font-bold text-xs rounded-xl text-center">
                            Agotado en sede
                          </div>
                        ) : inCartQty > 0 ? (
                          <div className="flex items-center justify-between bg-amber-400 rounded-xl px-2 py-1.5 text-slate-950 font-bold text-xs shadow-xs">
                            <button
                              type="button"
                              onClick={() => onUpdateQuantity(prod, inCartQty - 1)}
                              className="w-6 h-6 rounded-lg bg-black/10 hover:bg-black/20 flex items-center justify-center transition cursor-pointer"
                            >
                              <Minus className="w-3 h-3 stroke-[3]" />
                            </button>
                            <span className="tabular-nums font-black text-sm">{inCartQty}</span>
                            <button
                              type="button"
                              onClick={() => onUpdateQuantity(prod, inCartQty + 1)}
                              className="w-6 h-6 rounded-lg bg-black/10 hover:bg-black/20 flex items-center justify-center transition cursor-pointer"
                            >
                              <Plus className="w-3 h-3 stroke-[3]" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onAddToCart(prod)}
                            className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                          >
                            <ShoppingBag className="w-3.5 h-3.5" />
                            <span>Agregar</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Empty columns up to 3 */}
                {Array.from({ length: 3 - compareProducts.length }).map((_, idx) => (
                  <div
                    key={`slot-${idx}`}
                    className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-2 h-full text-slate-400 min-h-[220px]"
                  >
                    <Plus className="w-6 h-6 text-slate-300 stroke-[2]" />
                    <span className="text-xs font-semibold">Espacio libre</span>
                    <span className="text-[10px] text-slate-400">
                      Selecciona otro producto en la tienda para comparar
                    </span>
                  </div>
                ))}
              </div>

              {/* ROW 1: PESO Y PRESENTACIÓN */}
              <div className="grid grid-cols-4 gap-4 py-2.5 border-b border-slate-100 text-xs items-center">
                <span className="font-bold text-slate-500">Presentación / Peso</span>
                {compareProducts.map((p) => (
                  <div key={p.id} className="font-semibold text-slate-800">
                    <div>{p.presentation}</div>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      {p.weightKg} kg {p.unitPriceText && `· ${p.unitPriceText}`}
                    </div>
                  </div>
                ))}
                {Array.from({ length: 3 - compareProducts.length }).map((_, i) => (
                  <div key={i} className="text-slate-300">—</div>
                ))}
              </div>

              {/* ROW 2: ESPECIE Y CATEGORÍA */}
              <div className="grid grid-cols-4 gap-4 py-2.5 border-b border-slate-100 text-xs items-center">
                <span className="font-bold text-slate-500">Especie & Categoría</span>
                {compareProducts.map((p) => (
                  <div key={p.id} className="font-medium text-slate-700">
                    <span className="font-bold text-slate-900">{p.species}</span> · {p.category}
                  </div>
                ))}
                {Array.from({ length: 3 - compareProducts.length }).map((_, i) => (
                  <div key={i} className="text-slate-300">—</div>
                ))}
              </div>

              {/* ROW 3: FÓRMULA MÉDICA VETERINARIA */}
              <div className="grid grid-cols-4 gap-4 py-2.5 border-b border-slate-100 text-xs items-center">
                <span className="font-bold text-slate-500">Requiere Fórmula</span>
                {compareProducts.map((p) => (
                  <div key={p.id}>
                    {p.requiresPrescription ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-red-700 bg-red-50 border border-red-200/80 px-2 py-0.5 rounded-lg">
                        <FileText className="w-3 h-3 text-red-600" />
                        Sí (Médico Veterinario)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-lg">
                        <Check className="w-3 h-3 text-emerald-600" />
                        Venta Libre
                      </span>
                    )}
                  </div>
                ))}
                {Array.from({ length: 3 - compareProducts.length }).map((_, i) => (
                  <div key={i} className="text-slate-300">—</div>
                ))}
              </div>

              {/* ROW 4: REGISTRO ICA Y PRINCIPIO ACTIVO */}
              <div className="grid grid-cols-4 gap-4 py-2.5 border-b border-slate-100 text-xs items-center">
                <span className="font-bold text-slate-500">Registro ICA / Activo</span>
                {compareProducts.map((p) => (
                  <div key={p.id} className="text-[11px] text-slate-700 space-y-0.5">
                    {p.icaRegistration ? (
                      <div className="font-semibold text-slate-900">ICA: {p.icaRegistration}</div>
                    ) : (
                      <div className="text-slate-400">No aplica (Alimento/Accesorio)</div>
                    )}
                    {p.activeIngredient && (
                      <div className="text-slate-500">
                        {p.activeIngredient} {p.concentration && `(${p.concentration})`}
                      </div>
                    )}
                  </div>
                ))}
                {Array.from({ length: 3 - compareProducts.length }).map((_, i) => (
                  <div key={i} className="text-slate-300">—</div>
                ))}
              </div>

              {/* ROW 5: CADENA DE FRÍO & ALMACENAMIENTO */}
              <div className="grid grid-cols-4 gap-4 py-2.5 border-b border-slate-100 text-xs items-center">
                <span className="font-bold text-slate-500">Almacenamiento</span>
                {compareProducts.map((p) => (
                  <div key={p.id} className="text-[11px]">
                    {p.temperatureColdChain ? (
                      <span className="inline-flex items-center gap-1 text-blue-700 bg-blue-50 font-bold px-2 py-0.5 rounded-lg border border-blue-200">
                        <Snowflake className="w-3 h-3 text-blue-600" />
                        Cadena de Frío (2°C - 8°C)
                      </span>
                    ) : (
                      <span className="text-slate-600 font-medium">
                        Temperatura ambiente
                      </span>
                    )}
                  </div>
                ))}
                {Array.from({ length: 3 - compareProducts.length }).map((_, i) => (
                  <div key={i} className="text-slate-300">—</div>
                ))}
              </div>

              {/* ROW 6: STOCK EN BODEGA ASIGNADA */}
              <div className="grid grid-cols-4 gap-4 py-2.5 border-b border-slate-100 text-xs items-center">
                <span className="font-bold text-slate-500">Stock en Sede Activa</span>
                {compareProducts.map((p) => {
                  const stock = p.stockByStore[selectedStoreId] || 0;
                  const reserved = p.reservedStockByStore[selectedStoreId] || 0;
                  const available = Math.max(0, stock - reserved);
                  return (
                    <div key={p.id} className="text-[11px] tabular-nums font-semibold">
                      {available > 0 ? (
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                          {available} uds disponibles
                        </span>
                      ) : (
                        <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded-lg border border-red-200">
                          Agotado en sede
                        </span>
                      )}
                    </div>
                  );
                })}
                {Array.from({ length: 3 - compareProducts.length }).map((_, i) => (
                  <div key={i} className="text-slate-300">—</div>
                ))}
              </div>

              {/* ROW 7: BENEFICIOS Y DESCRIPCIÓN */}
              <div className="grid grid-cols-4 gap-4 py-3 text-xs items-start">
                <span className="font-bold text-slate-500">Beneficios Destacados</span>
                {compareProducts.map((p) => (
                  <div key={p.id} className="text-[11px] text-slate-600 leading-relaxed space-y-1">
                    <p className="line-clamp-4">{p.description}</p>
                    {p.authorizedInfo && (
                      <p className="text-[10px] text-slate-400 italic">
                        {p.authorizedInfo}
                      </p>
                    )}
                  </div>
                ))}
                {Array.from({ length: 3 - compareProducts.length }).map((_, i) => (
                  <div key={i} className="text-slate-300">—</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Hasta 3 productos simultáneos</span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
          >
            Cerrar comparador
          </button>
        </div>
      </div>
    </div>
  );
};
