import type {Product, ProductPresentation} from '../types';
import corrections from '../data/verifiedPresentations.json';

type VerifiedPresentation = {
  productId: string;
  expectedName: string;
  label: string;
  source: string;
  description?: {before: string; after: string};
};
const verified: Readonly<Record<string, VerifiedPresentation>> = corrections;

function verifiedPresentation(product: Product, variant: ProductPresentation): VerifiedPresentation | undefined {
  const correction = verified[variant.varianteId];
  if (correction?.productId === product.id && correction.expectedName === variant.nombre) {
    return correction;
  }
}

export function verifiedPresentationLabel(product: Product, variant: ProductPresentation): string | undefined {
  return verifiedPresentation(product, variant)?.label;
}

export function productDescription(product: Product): string {
  const variants = product.presentaciones;
  const correction = variants?.length === 1 ? verifiedPresentation(product, variants[0])?.description : undefined;
  return correction && product.description === correction.before ? correction.after : product.description;
}

const number = String.raw`\d+(?:[.,]\d+)?`;
const amount = `${number}(?:\\s*(?:[x×–-]|a|hasta)\\s*${number})*`;
const countUnits = String.raw`unidad(?:es)?|unds?|uds?|un|us|u|tabletas?|tabs?|tbls?|comprimidos?|comps?|sob(?:res?)?|tubos?|toallitas?|viales?|bl[ií]ster(?:es|s)?|cajas?|bolsas?|rollos?|packs?|barras?|hojas?|nuggets?|masticables?|mast`;
const measureUnits = String.raw`mg\s*\/\s*ml|kilogramos?|kgs?|gramos?|grs?|mg|g|mililitros?|ml|litros?|lts?|l|cc|cms?|mm|m|lbs?|onzas?|oz|watts?|w|pulgadas?|in|c[aá]psulas?|caps?`;
const quantityPattern = () => new RegExp(`(${amount})\\s*(${measureUnits}|${countUnits})\\b`, 'gi');
const packaging = /\b(?:bultos?|bolsas?|cajas?|paquetes?|packs?|bl[ií]ster(?:es|s)?|frascos?|goteros?|tallas?)\b/gi;
const normalizeAmount = (value:string) => value.replace(/\s*[x×]\s*/gi,' × ').replace(/\s*(?:[–-]|hasta|a)\s*/gi,'–');
const normalizeUnit = (value:string, amount: string) => {
  const unit=value.toLowerCase().replace(/\s/g,'');
  if(new RegExp(`^(?:${countUnits})$`,'i').test(unit))return 'u';
  if(/^(kg|kilogramo)/.test(unit))return 'kg';
  if(/^(gr|gramo)/.test(unit))return 'g';
  if(/^(ml|mililitro)/.test(unit))return 'ml';
  if(/^(lt|litro)/.test(unit))return 'l';
  if (/^onzas?$/.test(unit)) return 'oz';
  if (/^(w|watts?)$/.test(unit)) return 'W';
  if (/^(in|pulgadas?)$/.test(unit)) return 'in';
  if (/^c[aá]ps?(?:ulas?)?$/.test(unit)) return Number(amount.replace(',', '.')) === 1 ? 'cápsula' : 'cápsulas';
  return unit.replace(/^(cm|lb)s$/,'$1');
};

// Display only. Never rewrite stored variant names, identifiers or sale quantities.
const pending = 'Cantidad por confirmar';
const sizeCode = '(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL)';
const statedSize = new RegExp(String.raw`(?:^${sizeCode}|\btalla\s+${sizeCode})\b`, 'i');

function quantityLabel(raw:string):string {
  const descriptor = raw.trim().match(/^(pequeñ[oa]|median[oa]|grande|pelo largo|pelo corto)$/i)?.[1];
  if (descriptor) return descriptor[0].toLocaleUpperCase('es') + descriptor.slice(1).toLocaleLowerCase('es');
  const inches = raw.trim().match(/^([1-9]\d*(?:[.,]\d+)?)\s*["″]$/);
  if (inches) return `${inches[1]} in`;
  const text=raw.trim().replace(new RegExp(`^(?:caja|pack|paquete|bolsa|bl[ií]ster|roll)\\s*(?:x|de)\\s*(${number})\\s*(?=de\\s+\\d|$)`,'i'),'$1 u ');
  const matches=[...text.matchAll(quantityPattern())].filter(match => /[1-9]/.test(match[1]));
  const sizeMatch = text.match(statedSize);
  const size = (sizeMatch?.[1] || sizeMatch?.[2])?.toUpperCase();
  if(matches.length){
    let label=size||'';
    matches.forEach((match,index)=>{
      const token=`${normalizeAmount(match[1])} ${normalizeUnit(match[2], match[1])}`;
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
  return pending;
}

export function presentationChip(product:Product,id?:string):{label:string;detail?:string} {
  const variants=product.presentaciones||[];
  const variant=variants.find(v=>v.varianteId===id);
  const rawFor = (option?: ProductPresentation) => option?.nombre.trim()
    || (variants.length <= 1 ? product.presentation || '' : '');
  const raw = rawFor(variant);
  const catalogLabel = (value: string) => {
    if (/^únic[oa]$/i.test(value.trim()) && variants.length <= 1
      && (product.category === 'Accesorios' || product.category === 'Higiene'
        || product.tags?.some(tag => tag.trim().toLowerCase() === 'petlovers'))) {
      return 'Presentación única';
    }
    return quantityLabel(value);
  };
  const labelFor = (option: ProductPresentation) => verifiedPresentationLabel(product, option)
    ?? catalogLabel(rawFor(option));
  const label=variant ? labelFor(variant) : catalogLabel(raw);
  if(!variant)return {label};
  const duplicates=variants.filter(v=>labelFor(v)===label);
  if(duplicates.length<2)return {label};
  // Keep real differentiating attributes when quantities alone would look identical.
  const attributes=(value:string)=>value.replace(quantityPattern(),'').replace(packaging,'').replace(/^\s*x\b\s*|\s*\bx\s*$/gi,'').replace(/^[\s/·,;:()×–-]+|[\s/·,;:()×–-]+$/g,'').trim();
  const detail=attributes(raw);
  const distinct=detail&&duplicates.filter(v=>attributes(rawFor(v))===detail).length===1;
  if(distinct)return {label,detail};
  const uniqueSku=variant.sku&&duplicates.filter(v=>v.sku===variant.sku).length===1;
  return {label,detail:uniqueSku?`SKU ${variant.sku}`:`Ref. ${variant.varianteId.split('/').pop()}`};
}
