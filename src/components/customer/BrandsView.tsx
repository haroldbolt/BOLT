import React,{useState} from 'react';
import {ChevronRight,Search} from 'lucide-react';
import {normalizeBrand,type BrandEntry} from '../../lib/brandDirectory';

export function BrandButton({entry,onSelect}:{entry:BrandEntry;onSelect:(entry:BrandEntry)=>void}) {
  const [failed,setFailed]=useState(false);
  return <button type="button" aria-label={`Ver productos de ${entry.name}, ${entry.count} productos`} onClick={()=>onSelect(entry)}
    className="group flex min-h-32 min-w-0 flex-col items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-center transition hover:border-red-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
    <span className="flex h-16 w-full items-center justify-center overflow-hidden rounded-xl bg-white">
      {entry.image&&!failed?<img src={entry.image} alt={`Logo de ${entry.name}`} width="180" height="86" loading="lazy" decoding="async" onError={()=>setFailed(true)} className="max-h-full max-w-full object-contain"/>:<span className="break-words text-lg font-black text-slate-800">{entry.name}</span>}
    </span>
    <span className="text-sm font-bold text-slate-900">{entry.name}</span>
    <span className="flex items-center gap-1 text-xs font-semibold text-red-600">Ver productos <ChevronRight className="h-3 w-3" aria-hidden="true"/></span>
  </button>;
}

export function BrandsView({entries,onSelect,loading=false}:{entries:BrandEntry[];onSelect:(entry:BrandEntry)=>void;loading?:boolean}) {
  const [query,setQuery]=useState('');const [group,setGroup]=useState('Todas');
  const groups=[...new Set(entries.map(entry=>entry.group))];
  const filtered=entries.filter(entry=>(group==='Todas'||entry.group===group)&&normalizeBrand(entry.name).includes(normalizeBrand(query)));
  return <section aria-labelledby="brands-title" className="space-y-5 pb-4">
    <div><h2 id="brands-title" className="text-2xl font-black text-slate-900">Marcas</h2><p className="mt-1 text-sm text-slate-600">Encuentra tu marca favorita y compra sus productos.</p></div>
    <div className="relative max-w-xl"><label htmlFor="brand-search" className="mb-2 block text-sm font-bold text-slate-700">Busca tu marca</label>
      <Search className="pointer-events-none absolute bottom-3.5 left-3 h-4 w-4 text-slate-400" aria-hidden="true"/>
      <input id="brand-search" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ej. Agility Gold, Royal Canin" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"/>
    </div>
    <div aria-label="Filtrar marcas por tipo" className="flex flex-wrap gap-2">{['Todas',...groups].map(name=><button type="button" key={name} aria-pressed={group===name} onClick={()=>setGroup(name)} className={`min-h-11 rounded-full border px-4 py-2 text-xs font-bold transition ${group===name?'border-red-600 bg-red-600 text-white':'border-slate-200 bg-white text-slate-600 hover:border-red-300'}`}>{name}</button>)}</div>
    {loading?<p role="status" className="text-sm text-slate-500">Cargando marcas…</p>:!filtered.length?<p role="status" className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">No encontramos marcas con estos filtros. Prueba con otro nombre.</p>:groups.map(name=>{
      const brands=filtered.filter(entry=>entry.group===name);return brands.length?<section key={name} aria-label={name} className="space-y-3"><h3 className="text-base font-extrabold text-slate-800">{name}</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{brands.map(entry=><BrandButton key={entry.id} entry={entry} onSelect={onSelect}/>)}</div></section>:null;
    })}
  </section>;
}

export function BrandsShortcut({onClick}:{onClick:()=>void}) {
  return <button type="button" onClick={onClick} className="flex min-h-44 flex-col justify-between rounded-3xl border border-red-200 bg-red-50/50 p-4 text-left transition hover:border-red-400 focus-visible:ring-2 focus-visible:ring-red-600">
    <span className="text-sm font-extrabold text-slate-900">Marcas</span><span className="text-2xl font-black text-red-600">Tus favoritas,<br/>en un solo lugar.</span><span className="flex items-center gap-1 text-xs font-bold text-red-700">Explorar marcas <ChevronRight className="h-4 w-4" aria-hidden="true"/></span>
  </button>;
}
