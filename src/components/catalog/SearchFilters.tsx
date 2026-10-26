import React, { useState, useMemo } from 'react';
import { Product, ProductFilterState } from '../../types';
import { SlidersHorizontal, X, Search, Check, RotateCcw } from 'lucide-react';

interface SearchFiltersProps {
  filters: ProductFilterState;
  onChange: (filters: ProductFilterState) => void;
  onReset: () => void;
  products: Product[];
  totalFilteredCount: number;
  isMobileModalOpen: boolean;
  onCloseMobileModal: () => void;
}

export const INITIAL_FILTER_STATE: ProductFilterState = {
  minPrice: null,
  maxPrice: null,
  brands: [],
  minWeightKg: null,
  maxWeightKg: null,
};

// Rangos de precio predefinidos en COP
const PRICE_PRESETS = [
  { label: 'Todos', min: null, max: null },
  { label: '< $40.000', min: null, max: 40000 },
  { label: '$40.000 – $80.000', min: 40000, max: 80000 },
  { label: '$80.000 – $150.000', min: 80000, max: 150000 },
  { label: '> $150.000', min: 150000, max: null },
];

// Rangos de peso predefinidos en kg
const WEIGHT_PRESETS = [
  { label: 'Todos', min: null, max: null },
  { label: '< 2 kg', min: null, max: 2 },
  { label: '2 – 8 kg', min: 2, max: 8 },
  { label: '8 – 15 kg', min: 8, max: 15 },
  { label: '> 15 kg', min: 15, max: null },
];

export const SearchFilters: React.FC<SearchFiltersProps> = ({
  filters,
  onChange,
  onReset,
  products,
  totalFilteredCount,
  isMobileModalOpen,
  onCloseMobileModal,
}) => {
  const [brandSearch, setBrandSearch] = useState('');

  // Extraer marcas únicas y su conteo de productos
  const brandStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) {
      if (p.brand) {
        counts[p.brand] = (counts[p.brand] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
  }, [products]);

  // Filtrar marcas según el buscador
  const filteredBrands = useMemo(() => {
    if (!brandSearch.trim()) return brandStats;
    const q = brandSearch.toLowerCase();
    return brandStats.filter(b => b.brand.toLowerCase().includes(q));
  }, [brandStats, brandSearch]);

  const handlePricePreset = (min: number | null, max: number | null) => {
    onChange({
      ...filters,
      minPrice: min,
      maxPrice: max,
    });
  };

  const handleWeightPreset = (min: number | null, max: number | null) => {
    onChange({
      ...filters,
      minWeightKg: min,
      maxWeightKg: max,
    });
  };

  const toggleBrand = (brand: string) => {
    const exists = filters.brands.includes(brand);
    const updated = exists
      ? filters.brands.filter(b => b !== brand)
      : [...filters.brands, brand];
    onChange({ ...filters, brands: updated });
  };

  const isPricePresetActive = (min: number | null, max: number | null) => {
    return filters.minPrice === min && filters.maxPrice === max;
  };

  const isWeightPresetActive = (min: number | null, max: number | null) => {
    return filters.minWeightKg === min && filters.maxWeightKg === max;
  };

  const hasActiveFilters =
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    filters.brands.length > 0 ||
    filters.minWeightKg !== null ||
    filters.maxWeightKg !== null;

  // Renderizador del contenido interno de filtros
  const renderFilterControls = () => (
    <div className="space-y-6">
      {/* SECCIÓN 1: RANGO DE PRECIO */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Rango de Precio
          </label>
          {(filters.minPrice !== null || filters.maxPrice !== null) && (
            <button
              onClick={() => handlePricePreset(null, null)}
              className="text-[11px] text-blue-600 font-semibold hover:underline cursor-pointer"
            >
              Borrar
            </button>
          )}
        </div>

        {/* Botones rápidos de precio */}
        <div className="flex flex-wrap gap-1.5">
          {PRICE_PRESETS.map((preset, idx) => {
            const active = isPricePresetActive(preset.min, preset.max);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handlePricePreset(preset.min, preset.max)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-amber-400/20 border-amber-500 text-slate-900 font-bold'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* Campos manuales min / max */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <span className="text-[10px] text-slate-400 font-semibold block mb-0.5">Mínimo ($)</span>
            <input
              type="number"
              placeholder="$ 0"
              value={filters.minPrice !== null ? filters.minPrice : ''}
              onChange={(e) => {
                const val = e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : null;
                onChange({ ...filters, minPrice: isNaN(val as number) ? null : val });
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 tabular-nums text-slate-800"
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold block mb-0.5">Máximo ($)</span>
            <input
              type="number"
              placeholder="Sin límite"
              value={filters.maxPrice !== null ? filters.maxPrice : ''}
              onChange={(e) => {
                const val = e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : null;
                onChange({ ...filters, maxPrice: isNaN(val as number) ? null : val });
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 tabular-nums text-slate-800"
            />
          </div>
        </div>
      </div>

      <hr className="border-slate-100" />

      {/* SECCIÓN 2: MARCA ESPECÍFICA */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Marca {filters.brands.length > 0 && `(${filters.brands.length})`}
          </label>
          {filters.brands.length > 0 && (
            <button
              onClick={() => onChange({ ...filters, brands: [] })}
              className="text-[11px] text-blue-600 font-semibold hover:underline cursor-pointer"
            >
              Deseleccionar
            </button>
          )}
        </div>

        {/* Buscador de marcas */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar marca..."
            value={brandSearch}
            onChange={(e) => setBrandSearch(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 text-slate-800 placeholder:text-slate-400"
          />
          {brandSearch && (
            <button
              type="button"
              onClick={() => setBrandSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Lista con scroll de marcas */}
        <div className="max-h-48 overflow-y-auto space-y-1 pr-1 border border-slate-100 rounded-xl p-1.5 bg-slate-50/50">
          {filteredBrands.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-3">No hay marcas coincidentes</p>
          ) : (
            filteredBrands.map(({ brand, count }) => {
              const isSelected = filters.brands.includes(brand);
              return (
                <button
                  key={brand}
                  type="button"
                  onClick={() => toggleBrand(brand)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer text-left ${
                    isSelected
                      ? 'bg-amber-100/70 text-slate-900 font-bold'
                      : 'hover:bg-white text-slate-700 font-medium'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate pr-2">
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-amber-400 border-amber-500 text-slate-900'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                    <span className="truncate">{brand}</span>
                  </div>
                  <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                    {count}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <hr className="border-slate-100" />

      {/* SECCIÓN 3: RANGO DE PESO (KG) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Rango de Peso
          </label>
          {(filters.minWeightKg !== null || filters.maxWeightKg !== null) && (
            <button
              onClick={() => handleWeightPreset(null, null)}
              className="text-[11px] text-blue-600 font-semibold hover:underline cursor-pointer"
            >
              Borrar
            </button>
          )}
        </div>

        {/* Botones rápidos de peso */}
        <div className="flex flex-wrap gap-1.5">
          {WEIGHT_PRESETS.map((preset, idx) => {
            const active = isWeightPresetActive(preset.min, preset.max);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleWeightPreset(preset.min, preset.max)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-amber-400/20 border-amber-500 text-slate-900 font-bold'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* Campos manuales min / max peso */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <span className="text-[10px] text-slate-400 font-semibold block mb-0.5">Mín (kg)</span>
            <input
              type="number"
              step="0.5"
              placeholder="0 kg"
              value={filters.minWeightKg !== null ? filters.minWeightKg : ''}
              onChange={(e) => {
                const val = e.target.value ? Math.max(0, parseFloat(e.target.value)) : null;
                onChange({ ...filters, minWeightKg: isNaN(val as number) ? null : val });
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 tabular-nums text-slate-800"
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold block mb-0.5">Máx (kg)</span>
            <input
              type="number"
              step="0.5"
              placeholder="Sin límite"
              value={filters.maxWeightKg !== null ? filters.maxWeightKg : ''}
              onChange={(e) => {
                const val = e.target.value ? Math.max(0, parseFloat(e.target.value)) : null;
                onChange({ ...filters, maxWeightKg: isNaN(val as number) ? null : val });
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 tabular-nums text-slate-800"
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ------------------------------------------------------------- */}
      {/* BARRA LATERAL EN ESCRITORIO (md:block)                        */}
      {/* ------------------------------------------------------------- */}
      <aside className="hidden md:block w-64 lg:w-72 shrink-0 self-start sticky top-24 bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-slate-700" />
            <h3 className="font-extrabold text-sm text-slate-900">Filtros Avanzados</h3>
          </div>
          {hasActiveFilters && (
            <button
              onClick={onReset}
              className="text-xs text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1 cursor-pointer"
              title="Restablecer todos los filtros"
            >
              <RotateCcw className="w-3 h-3" />
              Limpiar
            </button>
          )}
        </div>

        {renderFilterControls()}

        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Coincidencias:</span>
          <span className="font-bold text-slate-900 tabular-nums">
            {totalFilteredCount} {totalFilteredCount === 1 ? 'producto' : 'productos'}
          </span>
        </div>
      </aside>

      {/* ------------------------------------------------------------- */}
      {/* MODAL DESLIZABLE EN MÓVIL (md:hidden)                         */}
      {/* ------------------------------------------------------------- */}
      {isMobileModalOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobileModal}
          />

          {/* Bottom Sheet Drawer */}
          <div className="relative bg-white rounded-t-3xl max-h-[85vh] flex flex-col shadow-2xl z-10 animate-in slide-in-from-bottom duration-200">
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-slate-800" />
                <h3 className="font-black text-base text-slate-900">Filtros Avanzados</h3>
              </div>
              <div className="flex items-center gap-3">
                {hasActiveFilters && (
                  <button
                    onClick={onReset}
                    className="text-xs text-rose-600 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Limpiar
                  </button>
                )}
                <button
                  onClick={onCloseMobileModal}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Filters Body */}
            <div className="px-5 py-4 overflow-y-auto space-y-6 flex-1">
              {renderFilterControls()}
            </div>

            {/* Sticky Action Footer */}
            <div className="p-4 border-t border-slate-100 bg-white/95 backdrop-blur-xs flex items-center gap-3">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={onReset}
                  className="px-4 py-3 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  Limpiar todo
                </button>
              )}
              <button
                type="button"
                onClick={onCloseMobileModal}
                className="flex-1 py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Ver {totalFilteredCount} {totalFilteredCount === 1 ? 'producto' : 'productos'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Componente para la barra de filtros activos (chips removibles)
interface ActiveFilterChipsProps {
  filters: ProductFilterState;
  onChange: (filters: ProductFilterState) => void;
  onReset: () => void;
  onOpenMobileFilters: () => void;
  totalFilteredCount: number;
}

export const ActiveFilterChips: React.FC<ActiveFilterChipsProps> = ({
  filters,
  onChange,
  onReset,
  onOpenMobileFilters,
  totalFilteredCount,
}) => {
  const activeChips: Array<{ id: string; label: string; onRemove: () => void }> = [];

  // Chip de precio
  if (filters.minPrice !== null && filters.maxPrice !== null) {
    activeChips.push({
      id: 'price',
      label: `$${filters.minPrice.toLocaleString('es-CO')} – $${filters.maxPrice.toLocaleString('es-CO')}`,
      onRemove: () => onChange({ ...filters, minPrice: null, maxPrice: null }),
    });
  } else if (filters.minPrice !== null) {
    activeChips.push({
      id: 'price-min',
      label: `Desde $${filters.minPrice.toLocaleString('es-CO')}`,
      onRemove: () => onChange({ ...filters, minPrice: null }),
    });
  } else if (filters.maxPrice !== null) {
    activeChips.push({
      id: 'price-max',
      label: `Hasta $${filters.maxPrice.toLocaleString('es-CO')}`,
      onRemove: () => onChange({ ...filters, maxPrice: null }),
    });
  }

  // Chips de marcas
  for (const brand of filters.brands) {
    activeChips.push({
      id: `brand-${brand}`,
      label: brand,
      onRemove: () => onChange({ ...filters, brands: filters.brands.filter(b => b !== brand) }),
    });
  }

  // Chip de peso
  if (filters.minWeightKg !== null && filters.maxWeightKg !== null) {
    activeChips.push({
      id: 'weight',
      label: `${filters.minWeightKg} – ${filters.maxWeightKg} kg`,
      onRemove: () => onChange({ ...filters, minWeightKg: null, maxWeightKg: null }),
    });
  } else if (filters.minWeightKg !== null) {
    activeChips.push({
      id: 'weight-min',
      label: `Desde ${filters.minWeightKg} kg`,
      onRemove: () => onChange({ ...filters, minWeightKg: null }),
    });
  } else if (filters.maxWeightKg !== null) {
    activeChips.push({
      id: 'weight-max',
      label: `Hasta ${filters.maxWeightKg} kg`,
      onRemove: () => onChange({ ...filters, maxWeightKg: null }),
    });
  }

  const activeCount = activeChips.length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 pb-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Botón de filtros para móvil */}
        <button
          type="button"
          onClick={onOpenMobileFilters}
          className={`md:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
            activeCount > 0
              ? 'bg-amber-400 text-slate-900 border-amber-500'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Filtros {activeCount > 0 && `(${activeCount})`}</span>
        </button>

        {/* Chips activos individuales */}
        {activeChips.map((chip) => (
          <span
            key={chip.id}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-slate-100 text-slate-800 border border-slate-200 font-medium"
          >
            <span>{chip.label}</span>
            <button
              type="button"
              onClick={chip.onRemove}
              className="text-slate-400 hover:text-slate-700 rounded p-0.5"
              aria-label={`Eliminar filtro ${chip.label}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        {activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-rose-600 hover:text-rose-700 font-bold ml-1 hover:underline cursor-pointer"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <span className="text-xs text-slate-500 font-semibold tabular-nums ml-auto">
        {totalFilteredCount} {totalFilteredCount === 1 ? 'resultado' : 'resultados'}
      </span>
    </div>
  );
};
