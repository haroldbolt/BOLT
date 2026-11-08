import type {Product} from '../types';

const number = String.raw`\d+(?:[.,]\d+)?`;
const amount = `${number}(?:\\s*(?:[x×–-]|a|hasta)\\s*${number})*`;
const countUnits = String.raw`unidades?|unds?|uds?|un|u|tabletas?|tabs?|comprimidos?|sobres?|tubos?|toallitas?|viales?|bl[ií]ster(?:es|s)?|cajas?|bolsas?|rollos?|packs?`;
const measureUnits = String.raw`mg\s*\/\s*ml|kilogramos?|kgs?|gramos?|grs?|mg|g|mililitros?|ml|litros?|lts?|l|cc|cms?|mm|m|lbs?|oz`;
const quantityPattern = () => new RegExp(`(${amount})\\s*(${measureUnits}|${countUnits})\\b`, 'gi');
const packaging = /\b(?:bultos?|bolsas?|cajas?|paquetes?|packs?|bl[ií]ster(?:es|s)?|frascos?|goteros?|tallas?)\b/gi;
const normalizeAmount = (value:string) => value.replace(/\s*[x×]\s*/gi,' × ').replace(/\s*(?:[–-]|hasta|a)\s*/gi,'–');
const normalizeUnit = (value:string) => {
  const unit=value.toLowerCase().replace(/\s/g,'');
  if(new RegExp(`^(?:${countUnits})$`,'i').test(unit))return 'u';
  if(/^(kg|kilogramo)/.test(unit))return 'kg';
  if(/^(gr|gramo)/.test(unit))return 'g';
  if(/^(ml|mililitro)/.test(unit))return 'ml';
  if(/^(lt|litro)/.test(unit))return 'l';
  return unit.replace(/^(cm|lb)s$/,'$1');
};

// Display only. Never rewrite stored variant names, identifiers or sale quantities.
function quantityLabel(raw:string):string {
  const text=raw.trim().replace(new RegExp(`^(?:caja|pack|paquete|bolsa|bl[ií]ster|roll)\\s*(?:x|de)\\s*(${number})\\s*(?=de\\s+\\d|$)`,'i'),'$1 u ');
  const matches=[...text.matchAll(quantityPattern())];
  const size=text.match(/^(?:Talla\s+)?(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL)\b/i)?.[1]?.toUpperCase();
  if(matches.length){
    let label=size||'';
    matches.forEach((match,index)=>{
      const token=`${normalizeAmount(match[1])} ${normalizeUnit(match[2])}`;
      if(!label){label=token;return;}
      const previous=matches[index-1];
      const between=text.slice(previous ? previous.index!+previous[0].length : 0,match.index);
      if(/\(/.test(between))label+=` (${token})`;
      else if(/\b(?:x|de)\b|×/i.test(between))label=label.replace(/ u$/,'')+` × ${token}`;
      else label+=`${between.includes('/') ? ' / ' : ' · '}${token}`;
    });
    return label;
  }
  if(size)return size;
  const bare=text.replace(packaging,'').replace(/^\s*[x×]\s*/i,'').trim();
  if(new RegExp(`^${amount}$`,'i').test(bare)&&/[1-9]/.test(bare))return normalizeAmount(bare);
  return 'Cantidad por confirmar';
}

export function presentationChip(product:Product,id?:string):{label:string;detail?:string} {
  const variants=product.presentaciones||[];
  const variant=variants.find(v=>v.varianteId===id);
  const raw=variant?.nombre||product.presentation||'';
  const label=quantityLabel(raw);
  if(!variant)return {label};
  const duplicates=variants.filter(v=>quantityLabel(v.nombre)===label);
  if(duplicates.length<2)return {label};
  // Keep real differentiating attributes when quantities alone would look identical.
  const attributes=(value:string)=>value.replace(quantityPattern(),'').replace(packaging,'').replace(/^\s*x\b\s*|\s*\bx\s*$/gi,'').replace(/^[\s/·,;:()×–-]+|[\s/·,;:()×–-]+$/g,'').trim();
  const detail=attributes(raw);
  const distinct=detail&&duplicates.filter(v=>attributes(v.nombre)===detail).length===1;
  if(distinct)return {label,detail};
  const uniqueSku=variant.sku&&duplicates.filter(v=>v.sku===variant.sku).length===1;
  return {label,detail:uniqueSku?`SKU ${variant.sku}`:`Ref. ${variant.varianteId.split('/').pop()}`};
}
