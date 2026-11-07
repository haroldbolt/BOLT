/** FICTITIOUS transport data, never imported by production configuration. */
import type {Product,DriverProfile} from '../types';
import {DEFAULT_TRANSPORT_CONFIG,type TransportConfig,type ExternalProviderSimulation} from '../types/transport';
import {generateScheduledSlots,evaluateDeliveryQuote as realQuote,type QuoteRequest} from '../lib/deliveryService';
import {INITIAL_PRODUCTS,INITIAL_STORES} from '../data/seedData';
export const fixtureDrivers:DriverProfile[]=['HUB_KENNEDY','HUB_ALAMOS','HUB_SUBA'].flatMap((store,index)=>Array.from({length:index===1?2:3},(_,i)=>({id:`SIM-${store}-${i+1}`,name:`SIMULACIÓN ${store} ${i+1}`,phone:'0000000000',vehiclePlate:'SIMULADO',vehicleType:'MOTO' as const,maxWeightKg:55,rating:0,photo:'',isOnline:true,currentStatus:'DISPONIBLE' as const,currentLocation:{lat:0,lng:0,updatedAt:new Date().toISOString()},cashBalance:0})));
export function fixtureConfig():TransportConfig {return {...structuredClone(DEFAULT_TRANSPORT_CONFIG),maxDispatches:3,vehicles:fixtureDrivers.map(d=>({driverId:d.id,enabled:true,storeIds:[d.id.split('-').slice(1,-1).join('-')],modes:['TURBO','PROGRAMADO'],maxLoadGrams:55000,packagingGrams:500,cargoDimensionsCm:[80,60,60],maxVolumeCm3:288000,scheduledSlots:generateScheduledSlots(new Date()).map(s=>`${s.date}|${s.slotId}`)}))};}
export function fixtureProduct(id:string,weightGrams:number,category:Product['category']='Alimentos',eligible=false):Product {return {...structuredClone(INITIAL_PRODUCTS[0]),id,sku:id,name:`SIMULACIÓN ${id}`,presentation:`${weightGrams/1000} kg`,category,price:10000,originalPrice:undefined,discountPercent:undefined,unitPriceText:undefined,isLightningDeal:false,weightKg:weightGrams/1000,transport:{weightGrams,packagingGrams:100,dimensionsCm:[30,20,10],bulky:false,lightMarginEligible:eligible},presentaciones:undefined,stockByStore:{HUB_KENNEDY:100,HUB_ALAMOS:100,HUB_SUBA:100},reservedStockByStore:{HUB_KENNEDY:0,HUB_ALAMOS:0,HUB_SUBA:0},status:'ACTIVE'};}
// Existing geography tests use explicitly synthetic measurements and availability.
export function fixtureQuote(req:QuoteRequest,stores=INITIAL_STORES,products:Product[]=[],orders:any[]=[]) {
 const fixtures=products.map(p=>({...p,transport:{weightGrams:Math.round((p.weightKg>0?p.weightKg:0.1)*1000),packagingGrams:100,dimensionsCm:[10,10,10] as [number,number,number],bulky:false,lightMarginEligible:false}}));
 const config=fixtureConfig();
 return realQuote(req,stores,fixtures,orders,{config,drivers:fixtureDrivers,orders});
}

export function fixtureExternalProvider():ExternalProviderSimulation {return {id:'external-fixture',name:'Red externa de prueba',integration:'SIMULATION',enabled:true,storeIds:['HUB_KENNEDY','HUB_ALAMOS','HUB_SUBA'],modes:['TURBO','PROGRAMADO'],response:'ACCEPTED',respondsAt:new Date(Date.now()+300000).toISOString(),offerExpiresAt:new Date(Date.now()+3600000).toISOString(),availableVehicles:5,shippingPerDispatchCOP:8000,estimatedMinutes:20,maxLoadGrams:55000,cargoDimensionsCm:[80,60,60],maxVolumeCm3:288000,packagingGrams:500,scheduledSlots:generateScheduledSlots(new Date()).map(s=>`${s.date}|${s.slotId}`)};}
