import type { DeliveryQuote, QuoteRequest } from './deliveryService';
import type { Product, Store } from '../types';
import { planTransport, type TransportContext } from './transportPlanner';
import {externalAvailability} from './externalDelivery';
export function applyTransportQuote(q: DeliveryQuote, req: QuoteRequest, stores: Store[], products: Product[], context: TransportContext): DeliveryQuote {
  if(!req.items?.length || ['ADDRESS_NEEDS_CONFIRMATION','OUT_OF_COVERAGE','INSUFFICIENT_STOCK','STORE_CLOSED'].includes(q.eligibilityStatus) || !q.assignedStoreId) return q;
  // Preserve the geographical/slot rejection instead of replacing it with a capacity success.
  const rejectedSlot = !!req.scheduledWindow && (q.reasonCode==='SLOT_CAPACITY_EXCEEDED' || (q.selectedSlotInvalid===true && q.reasonCode==='MODE_UNAVAILABLE')) && !q.recommendedMode;
  if(['SLOT_CAPACITY_EXCEEDED','MODE_UNAVAILABLE'].includes(q.reasonCode || '') && !q.recommendedMode && !rejectedSlot) {
    q.basketValidated=false;
    return q;
  }
  const subtotal=req.items.reduce((a,i)=>a+(products.find(p=>p.id===i.productId)?.price || 0)*i.quantity,0);
  const pricing=context.config.pricing;
  const provisionalPricing=(q.recommendedMode || q.effectiveMode || req.requestedMode)==='PROGRAMADO' ? pricing : pricing.turbo || pricing;
  const provisionalShipping=subtotal>=provisionalPricing.freeShippingFrom?0:provisionalPricing.shipping;
  q.charges={subtotal,freeShippingFrom:provisionalPricing.freeShippingFrom,shipping:provisionalShipping,serviceFee:pricing.serviceFee,total:subtotal+provisionalShipping+pricing.serviceFee};
  q.inventoryValidated=q.basketValidated;
  q.providerResponses=externalAvailability(context.config,Date.now(),{storeId:q.assignedStoreId,mode:req.requestedMode==='PROGRAMADO'?'PROGRAMADO':'TURBO'}).responses;
  // Scheduled capacity is checked separately against its territorial store and each explicit slot.
  const scheduledStore=stores.find(s=>s.id===q.territoryInfo?.assignedStoreId);
  const scheduledPlans=new Map<string,ReturnType<typeof planTransport>>();
  if((q.scheduledEligible || rejectedSlot) && scheduledStore) for(const slot of q.scheduledSlots) {
    if(slot.availableCapacity<=0 || slot.cutoffPassed) continue;
    const key=`${slot.date}|${slot.slotId}`;
    const plan=planTransport(req.items,products,scheduledStore.id,'PROGRAMADO',context,key);
    scheduledPlans.set(key,plan);
    if(!plan.feasible) {slot.availableCapacity=0;slot.unavailableReason='TRANSPORT';slot.unavailableMessage=plan.message;}
  }
  q.scheduledEligible=q.scheduledEligible && q.scheduledSlots.some(s=>s.availableCapacity>0);
  q.availableModes.scheduled=q.scheduledEligible;
  if(rejectedSlot) {
    // Check alternative dates without accepting or replacing the rejected selection.
    q.availableModes.scheduled=q.scheduledSlots.some(s=>s.availableCapacity>0 && !s.cutoffPassed);
    q.basketValidated=false;
    return q;
  }
  const selected=req.scheduledWindow;
  const selectedKey=selected ? `${selected.date}|${selected.slotId}` : undefined;
  let turbo = q.availableModes.turbo || q.availableModes.turboDividido
    ? planTransport(req.items,products,q.assignedStoreId,'TURBO',context) : undefined;
  const enabledModes=stores.find(s=>s.id===q.assignedStoreId)?.enabledModes;
  if(turbo?.feasible && enabledModes && !enabledModes.includes(turbo.shipments.length>1?'TURBO_DIVIDIDO':'TURBO')) {
    turbo={...turbo,feasible:false,shipments:[],reasonCode:'MODE_UNAVAILABLE',message:'La sede no tiene habilitada esta modalidad. Revisa las franjas programadas disponibles.'};
  }
  q.availableModes.turbo=!!turbo?.feasible && turbo.shipments.length===1;
  q.availableModes.turboDividido=!!turbo?.feasible && turbo.shipments.length>1;
  let plan=turbo;
  if(req.requestedMode==='PROGRAMADO' || !turbo?.feasible) {
    const key=selectedKey || [...scheduledPlans.keys()].find(k=>scheduledPlans.get(k)!.feasible);
    const scheduled=key ? scheduledPlans.get(key) : undefined;
    if(scheduled?.feasible && q.scheduledEligible) {
      plan=scheduled; q.recommendedMode='PROGRAMADO'; q.autoSwitchedToScheduled=req.requestedMode!=='PROGRAMADO';
      q.assignedStoreId=scheduledStore!.id; q.assignedStoreName=scheduledStore!.name; q.assignedStoreAddress=scheduledStore!.address;
      q.eligibilityStatus='SCHEDULED_ONLY';
      q.transportWindow=q.scheduledSlots.find(s=>`${s.date}|${s.slotId}`===key);
    } else if(req.requestedMode==='PROGRAMADO') plan=scheduled || [...scheduledPlans.values()][0];
  } else {
    q.recommendedMode=turbo.shipments.length>1?'TURBO_DIVIDIDO':'TURBO';
    q.eligibilityStatus='ELIGIBLE';
  }
  if(!plan?.feasible || (req.requestedMode==='PROGRAMADO' && !q.scheduledEligible)) {
    const diagnostic=plan || [...scheduledPlans.values()][0] || planTransport(req.items,products,q.assignedStoreId,q.effectiveMode==='PROGRAMADO'?'PROGRAMADO':'TURBO',context,selectedKey);
    q.transportPlan=diagnostic; q.reasonCode=diagnostic.reasonCode; q.message=diagnostic.message;
    q.basketValidated=false; q.recommendedMode=null; q.eligibilityStatus='ESTIMATE_UNAVAILABLE';
    q.availableModes.turbo=false; q.availableModes.turboDividido=false; return q;
  }
  q.transportPlan=plan; q.reasonCode=plan.reasonCode; q.message=plan.message;
  const turboPricing=q.recommendedMode!=='PROGRAMADO' ? pricing.turbo : undefined;
  const effectivePricing=turboPricing || pricing;
  // Provider operating costs stay in the transport plan. A Turbo customer pays the
  // configured flat tariff once, regardless of the number or source of vehicles.
  const ownShipping=turboPricing
    ? (subtotal>=turboPricing.freeShippingFrom?0:turboPricing.shipping)
    : (plan.shipments.some(s=>!s.vehicle.externalOffer) && subtotal<pricing.freeShippingFrom ? pricing.shipping : 0);
  const externalShipping=turboPricing?0:plan.shipments.reduce((sum,s)=>sum+(s.vehicle.externalOffer?.shippingCOP || 0),0);
  q.charges={subtotal,freeShippingFrom:effectivePricing.freeShippingFrom,ownShipping,externalShipping,shipping:ownShipping+externalShipping,serviceFee:pricing.serviceFee,total:subtotal+ownShipping+externalShipping+pricing.serviceFee};
  if(q.recommendedMode!=='PROGRAMADO') q.estimatedMinutes=Math.max(...plan.shipments.map(s=>s.vehicle.externalOffer?.estimatedMinutes || q.estimatedMinutes || 25));
  q.basketValidated=!!q.inventoryValidated;
  q.totalWeightGrams=plan.shipments.reduce((a,s)=>a+s.productWeightGrams,0); q.totalWeightKg=q.totalWeightGrams/1000;
  // Reuse the existing split presentation contract. Proposal IDs are deterministic, not dispatch orders or PINs.
  q.turboDividido={totalWeightGrams:q.totalWeightGrams,totalWeightKg:q.totalWeightKg,thresholdGrams:context.config.baseLimitGrams,
    shipmentCount:plan.shipments.length,maxWeightPerVehicleKg:Math.max(...plan.shipments.map(s=>s.vehicle.maxLoadGrams))/1000,
    feasible:true,explanation:plan.message,commonDeadlineSeconds:1500,allShipmentsMeetDeadline:q.recommendedMode==='PROGRAMADO' || (q.estimatedMinutes || 26)<=25,
    shipments:plan.shipments.map((s,index)=>{
      const items=s.items.map(i=>{const p=products.find(p=>p.id===i.productId)!;return {...i,name:`${p.name} · ${p.presentation}`,unitWeightKg:p.transport!.weightGrams/1000,totalWeightKg:p.transport!.weightGrams*i.quantity/1000,totalWeightGrams:p.transport!.weightGrams*i.quantity,price:p.price};});
      const subtotal=items.reduce((a,i)=>a+i.price*i.quantity,0);
      return {shipmentIndex:index+1,shipmentId:`proposal-${index+1}`,items,weightGrams:s.productWeightGrams,weightKg:s.productWeightGrams/1000,subtotal,cashToCollect:subtotal,estimatedArrivalSeconds:(s.vehicle.externalOffer?.estimatedMinutes || q.estimatedMinutes || 0)*60,secretDeliveryCode:''};
    })};
  return q;
}
