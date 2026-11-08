import React, {useId} from 'react';
import type {Product} from '../../types';
import {saleVariant} from '../../lib/variantCommerce';
import {presentationChip} from '../../lib/presentationDisplay';
import {optionStock} from '../../lib/catalogPurchase';

export function PresentationSelector({product, selectedId, onSelect, selectorRef, storeId, disabled=false}: {
  product:Product; selectedId?:string; onSelect:(id:string)=>void; selectorRef:React.RefObject<HTMLFieldSetElement | null>; storeId?:string; disabled?:boolean;
}) {
  const name = useId();
  const variants = product.presentaciones || [];
  const chipClass = (selected:boolean) => `relative inline-flex flex-col items-center justify-center w-fit max-w-full min-w-11 min-h-11 rounded-xl border px-3 py-2 text-center transition ${selected ? 'bg-red-50 border-red-600 text-red-800 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-red-300'}`;
  return <fieldset ref={selectorRef} disabled={disabled} className="mt-2 min-w-0 disabled:opacity-60" aria-label={`Presentación de ${product.name}`}>
    <legend className="text-[11px] font-bold text-slate-600 mb-1.5">Presentación</legend>
      <div className="flex flex-wrap items-start gap-2">
        {!variants.length && <span className={chipClass(!!product.presentation)}>
          <span className="block text-xs font-extrabold break-words">{presentationChip(product).label}</span>
        </span>}
        {variants.map((v,index) => {
          const sale = saleVariant(product,v.varianteId);
          const chip = presentationChip(product,v.varianteId);
          const stock=optionStock(sale,storeId);
          const stockLabel=stock==='out' ? 'Agotado en esta sede' : stock==='unavailable' ? 'No disponible en esta sede' : '';
          const stockId=`${name}-${index}-stock`;
          return <div key={v.varianteId} className="flex flex-col items-start max-w-full">
            <label className={`${chipClass(selectedId===v.varianteId)} cursor-pointer focus-within:ring-2 focus-within:ring-red-500 focus-within:ring-offset-2`}>
            <input className="sr-only" type="radio" name={name} value={v.varianteId} checked={selectedId===v.varianteId} onChange={()=>onSelect(v.varianteId)} aria-label={`${chip.label}${chip.detail ? `, ${chip.detail}` : ''}`} aria-describedby={stockLabel ? stockId : undefined} />
            <span className="block text-xs font-extrabold break-words">{chip.label}</span>
            {chip.detail && <span className="block text-[10px] leading-4 mt-0.5">{chip.detail}</span>}
            </label>
            {stockLabel && <span id={stockId} className="max-w-32 text-[10px] leading-4 text-red-700 mt-0.5">{stockLabel}</span>}
          </div>;
        })}
      </div>
  </fieldset>;
}
