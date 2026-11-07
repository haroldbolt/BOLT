import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import type {Product} from '../../types';
import type {DeliveryQuote, QuoteRequest} from '../../lib/deliveryService';
import {api} from '../../lib/api';
import {hasSalePrice, presentationAvailability, prospectiveItems, selectedPresentation} from '../../lib/presentationSelection';
import {CartActionGate, validateCartAddition} from '../../lib/catalogPurchase';

type Feedback={productId:string;variantId?:string;text:string;error:boolean};
type Context = {choices:Record<string,string>; select:(product:string,id:string)=>void; request:QuoteRequest; quantities:Record<string,number>; quote:(request:QuoteRequest)=>Promise<DeliveryQuote>; storeId?:string; busyId?:string; feedback?:Feedback; add:(product:Product,commit:(product:Product)=>void)=>Promise<void>};
const PresentationContext=createContext<Context | null>(null);

export function PresentationProvider({request, quantities, children, deliveryQuote}: {request:QuoteRequest; quantities:Record<string,number>; children:React.ReactNode; deliveryQuote?:DeliveryQuote | null}) {
  const [choices,setChoices]=useState<Record<string,string>>({});
  const [busyId,setBusyId]=useState<string>();
  const [feedback,setFeedback]=useState<Feedback>();
  const gate=useRef(new CartActionGate());
  const live=useRef({request,choices});live.current={request,choices};
  useEffect(()=>{if(!feedback)return;const timer=setTimeout(()=>setFeedback(undefined),4000);return()=>clearTimeout(timer);},[feedback]);
  // Bounded, short lived, server-only quote cache; each key includes the complete destination, cart, mode and slot.
  const cache=useRef(new Map<string,{until:number;promise:Promise<DeliveryQuote>}>());
  const quote=React.useCallback((req:QuoteRequest)=>{
    const key=JSON.stringify(req), now=Date.now(), previous=cache.current.get(key);
    if(previous && previous.until>now) return previous.promise;
    if(cache.current.size>=100) cache.current.delete(cache.current.keys().next().value!);
    const promise=api.getDeliveryQuote(req).catch(error=>{cache.current.delete(key);throw error;});
    cache.current.set(key,{until:now+15000,promise});
    return promise;
  },[]);
  const add=async(product:Product,commit:(product:Product)=>void)=>{
    await gate.current.run(async()=>{
      setBusyId(product.id);setFeedback(undefined);
      const before=JSON.stringify(live.current), snapshot=live.current.request;
      const productId=product.parentProductId || product.id;
      try {
        // This write-facing check bypasses the display cache. Stock is still revalidated at checkout.
        await validateCartAddition({product,request:snapshot,quote:api.getDeliveryQuote,isCurrent:()=>JSON.stringify(live.current)===before,commit});
        cache.current.clear();
        setFeedback({productId,variantId:product.variantId,text:`Agregado al carrito: ${product.presentation}`,error:false});
      } catch(error) {
        setFeedback({productId,variantId:product.variantId,text:error instanceof Error ? error.message : 'No se pudo agregar. Intenta nuevamente.',error:true});
      } finally {cache.current.clear();setBusyId(undefined);}
    });
  };
  const destination=request.destination;
  const confirmed=deliveryQuote?.destination.address===destination.address && deliveryQuote.destination.coordinates.lat===destination.coordinates?.lat && deliveryQuote.destination.coordinates.lng===destination.coordinates?.lng && (request.requestedMode!=='PROGRAMADO' || deliveryQuote.recommendedMode==='PROGRAMADO');
  return <PresentationContext.Provider value={{choices,select:(p,id)=>{setChoices(old=>({...old,[p]:id}));setFeedback(undefined);},request,quantities,quote,storeId:confirmed ? deliveryQuote?.assignedStoreId : undefined,busyId,feedback,add}}>{children}</PresentationContext.Provider>;
}

export function usePresentation(product:Product) {
  const ctx=useContext(PresentationContext);
  if(!ctx) throw new Error('PresentationProvider is required');
  const selectorRef=useRef<HTMLFieldSetElement>(null);
  const [visible,setVisible]=useState(false);
  const selected=selectedPresentation(product,ctx.choices[product.id]);
  const [result,setResult]=useState<{key:string;quote:DeliveryQuote|null}>();
  const [revision,retry]=useState(0);
  const hasDestination=!!ctx.request.destination.address.trim() && Number.isFinite(ctx.request.destination.coordinates?.lat) && Number.isFinite(ctx.request.destination.coordinates?.lng);
  const request:QuoteRequest={...ctx.request,items:selected ? prospectiveItems(ctx.request.items || [],selected) : []};
  const key=JSON.stringify(request);
  useEffect(()=>{
    const el=selectorRef.current;
    if(!el) return;
    if(typeof IntersectionObserver==='undefined') {setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)),{rootMargin:'120px'});
    observer.observe(el);return()=>observer.disconnect();
  },[product.id]);
  useEffect(()=>{
    if(!selected || !hasSalePrice(selected) || !hasDestination || !visible) return;
    let cancelled=false;
    setResult(undefined);
    ctx.quote(request).then(quote=>{if(!cancelled)setResult({key,quote});}).catch(()=>{if(!cancelled)setResult({key,quote:null});});
    // Refresh only visible choices, and invalidate immediately on return to the tab.
    const timer=setTimeout(()=>retry(v=>v+1),30000);
    const refresh=()=>{if(document.visibilityState==='visible')retry(v=>v+1);};
    document.addEventListener('visibilitychange',refresh);
    return()=>{cancelled=true;clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);};
  },[key,selected?.commerceRevision,visible,hasDestination,revision,ctx.quote]);
  const current=result?.key===key ? result : undefined;
  const availability=presentationAvailability(selected,current?.quote || null,!current,hasDestination);
  const focusSelector=()=>{selectorRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'});selectorRef.current?.querySelector<HTMLInputElement>('input:checked, input')?.focus();};
  return {selected,selectedId:selected?.variantId,select:(id:string)=>ctx.select(product.id,id),selectorRef,focusSelector,availability,quantity:selected ? ctx.quantities[selected.id] || 0 : 0,retry:()=>retry(v=>v+1),storeId:current?.quote?.assignedStoreId || ctx.storeId,busy:!!ctx.busyId,adding:!!selected && ctx.busyId===selected.id,feedback:ctx.feedback?.productId===product.id && ctx.feedback.variantId===selected?.variantId ? ctx.feedback : undefined,add:async(commit:(product:Product)=>void)=>{if(!selected){focusSelector();return;}await ctx.add(selected,commit);retry(v=>v+1);}};
}
