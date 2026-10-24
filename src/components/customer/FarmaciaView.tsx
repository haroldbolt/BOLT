import React, { useState } from 'react';
import { ShieldCheck, FileText, AlertCircle, Info, Filter, ArrowLeft, Upload, CheckCircle2 } from 'lucide-react';
import { Product, PharmacySubcategory } from '../../types';
import { ProductCard } from './ProductCard';

interface FarmaciaViewProps {
  products: Product[];
  selectedStoreId: string;
  cartQuantities: Record<string, number>;
  onAddToCart: (p: Product) => void;
  onUpdateQuantity: (p: Product, q: number) => void;
  favorites: Record<string, boolean>;
  onToggleFavorite: (p: Product) => void;
  onOpenDetails: (p: Product) => void;
  onBackToHome: () => void;
}

const PHARMACY_SUBCATEGORIES: PharmacySubcategory[] = [
  'Antipulgas y garrapatas',
  'Desparasitación',
  'Dermatología',
  'Oídos y ojos',
  'Cuidado digestivo',
  'Vitaminas y suplementos',
  'Curación y primeros auxilios',
  'Medicamentos veterinarios',
];

export const FarmaciaView: React.FC<FarmaciaViewProps> = ({
  products,
  selectedStoreId,
  cartQuantities,
  onAddToCart,
  onUpdateQuantity,
  favorites,
  onToggleFavorite,
  onOpenDetails,
  onBackToHome,
}) => {
  const [activeSubcat, setActiveSubcat] = useState<PharmacySubcategory | 'TODAS'>('TODAS');
  const [filterPrescriptionOnly, setFilterPrescriptionOnly] = useState(false);
  const [showFormulaInfoModal, setShowFormulaInfoModal] = useState(false);

  // Filter pharmacy items
  const pharmacyProducts = products.filter(p => {
    const isPharm = p.category === 'Farmacia' || p.category === 'Antipulgas' || !!p.pharmacySubcategory;
    if (!isPharm) return false;
    if (activeSubcat !== 'TODAS' && p.pharmacySubcategory !== activeSubcat) return false;
    if (filterPrescriptionOnly && !p.requiresPrescription) return false;
    return true;
  });

  return (
    <div className="space-y-4 pb-20">
      {/* Header Banner */}
      <div className="bg-linear-to-r from-red-700 via-red-600 to-rose-600 rounded-3xl p-5 text-white shadow-sm relative overflow-hidden">
        <div className="relative z-10 space-y-2">
          <button
            onClick={onBackToHome}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-red-200 hover:text-white bg-black/20 hover:bg-black/30 px-3 py-1 rounded-full transition mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver a Turbo
          </button>
          <div className="flex items-center gap-2">
            <span className="text-2xl">💊</span>
            <h1 className="text-2xl font-black tracking-tight">Farmacia Veterinaria Oficial</h1>
          </div>
          <p className="text-xs text-red-100 max-w-lg leading-relaxed">
            Medicamentos autorizados con Registro ICA, trazabilidad de lote y vencimiento.
            Revisión por personal farmacéutico veterinario colegiado.
          </p>

          <div className="pt-1 flex flex-wrap gap-2">
            <button
              onClick={() => setShowFormulaInfoModal(true)}
              className="bg-yellow-400 hover:bg-yellow-300 text-red-950 font-black text-xs px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm transition"
            >
              <Info className="w-3.5 h-3.5" />
              ¿Cómo funciona la fórmula médica?
            </button>
            <span className="inline-flex items-center gap-1 text-[11px] bg-red-900/60 text-red-100 px-3 py-1 rounded-full font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              100% Originales & Lotes Verificados
            </span>
          </div>
        </div>
      </div>

      {/* Subcategory Pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
        <button
          onClick={() => setActiveSubcat('TODAS')}
          className={`px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap transition shadow-xs ${
            activeSubcat === 'TODAS'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
          }`}
        >
          Todas ({pharmacyProducts.length})
        </button>
        {PHARMACY_SUBCATEGORIES.map(sub => {
          const isSelected = activeSubcat === sub;
          return (
            <button
              key={sub}
              onClick={() => setActiveSubcat(sub)}
              className={`px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap transition shadow-xs ${
                isSelected
                  ? 'bg-red-600 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {sub}
            </button>
          );
        })}
      </div>

      {/* Filters row */}
      <div className="flex items-center justify-between text-xs text-slate-600 px-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterPrescriptionOnly(!filterPrescriptionOnly)}
            className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition ${
              filterPrescriptionOnly
                ? 'bg-red-600 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Solo con fórmula médica
          </button>
        </div>
        <span className="font-semibold">{pharmacyProducts.length} productos disponibles</span>
      </div>

      {/* Pharmacy Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {pharmacyProducts.map(prod => (
          <ProductCard
            key={prod.id}
            product={prod}
            quantityInCart={cartQuantities[prod.id] || 0}
            onAddToCart={onAddToCart}
            onUpdateQuantity={onUpdateQuantity}
            isFavorite={!!favorites[prod.id]}
            onToggleFavorite={onToggleFavorite}
            onOpenDetails={onOpenDetails}
            selectedStoreId={selectedStoreId}
          />
        ))}
      </div>

      {/* Modal Explanation: Prescription Gate */}
      {showFormulaInfoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center shrink-0">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">Normativa de Fórmulas Veterinarias</h3>
                <p className="text-xs text-slate-500">Resolución ICA & Farmacovigilancia Colombia</p>
              </div>
            </div>

            <div className="space-y-2.5 text-xs text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <p>
                <strong>1. Identificación:</strong> Los medicamentos veterinarios controlados (como antibióticos, AINEs y moduladores) llevan la etiqueta roja <em>“Requiere fórmula médica”</em>.
              </p>
              <p>
                <strong>2. Subida del Documento:</strong> Durante el checkout podrás adjuntar foto o PDF de la receta expedida por un Médico Veterinario con tarjeta profesional válida en Colombia.
              </p>
              <p>
                <strong>3. Validación Farmacéutica:</strong> Nuestro químico farmacéutico veterinario verificará la prescripción, posología y fechas antes de autorizar el despacho físico.
              </p>
              <p>
                <strong>4. Seguridad de tu Mascota:</strong> No inventamos dosis ni sustituimos medicamentos sin autorización del profesional tratante.
              </p>
            </div>

            <button
              onClick={() => setShowFormulaInfoModal(false)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 rounded-2xl text-xs transition"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
