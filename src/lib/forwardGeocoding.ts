import {coverageMunicipality, normalizeTerritoryString} from '../data/coverageConfig';
import {parseAddressComponents, validDestinationCoordinates} from './addressGeography';
import {enrichDestination} from './serverGeography';
import type {AddressSearchResult, AddressSearchCandidate} from './addressSearch';

const municipalityKey=(value?:string)=>coverageMunicipality(value)?.code || normalizeTerritoryString(value);

/** Municipality is a search constraint, never a coverage authorization. No first-result selection. */
export async function searchDeliveryAddress(address:string, municipality:string, apiKey:string, fetcher:typeof fetch=fetch):Promise<AddressSearchResult> {
  if(!municipality.trim()) return {status:'MUNICIPALITY_REQUIRED',candidates:[],message:'Elige el municipio de entrega para buscar la dirección en el lugar correcto.'};
  if(!address.trim()) return {status:'NO_RESULTS',candidates:[],message:'Escribe la dirección completa de entrega.'};
  const requestedPolicy=coverageMunicipality(municipality);
  const name=requestedPolicy?.name || municipality.trim();
  const url=new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.search=new URLSearchParams({address:address.trim(),components:`country:CO|locality:${name==='Bogotá D.C.'?'Bogotá':name}`,language:'es',region:'co',key:apiKey}).toString();
  try {
    const response=await fetcher(url,{signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw Error('Provider unavailable');
    const data:any=await response.json();
    if(!['OK','ZERO_RESULTS'].includes(data.status)) throw Error('Provider unavailable');
    const candidates:AddressSearchCandidate[]=[];
    let mismatched=false;
    for(const result of data.results || []) {
      const coordinates=result.geometry?.location;
      if(!validDestinationCoordinates(coordinates)) continue;
      const provider=parseAddressComponents(result.address_components);
      const resolved=enrichDestination({coordinates});
      // Local polygons take precedence over provider text (including a street mentioning Bogotá).
      const actual=resolved.municipality || provider.municipality;
      if(provider.countryCode!=='CO' || (requestedPolicy && resolved.municipalityCode!==requestedPolicy.code) || municipalityKey(actual)!==municipalityKey(municipality)) {mismatched=true;continue;}
      // A city/route centroid or partial match must not silently become a delivery address.
      if(result.partial_match || !result.types?.some((type:string)=>['street_address','premise','subpremise'].includes(type))) continue;
      if(!result.place_id || !result.formatted_address || candidates.some(c=>c.placeId===result.place_id)) continue;
      candidates.push({placeId:result.place_id,formattedAddress:result.formatted_address,coordinates,
        municipality:actual,countryCode:'CO',locality:resolved.locality,neighborhood:provider.neighborhood});
    }
    if(candidates.length) return {status:'SELECT_ADDRESS',candidates,message:'Selecciona la dirección encontrada y revisa el punto de entrega.'};
    return {status:mismatched?'MUNICIPALITY_MISMATCH':'NO_RESULTS',candidates:[],message:mismatched
      ?'El resultado no corresponde al municipio elegido. Revisa el municipio y la dirección; no cambiamos tu destino.'
      :'No encontramos una dirección exacta en ese municipio. Completa la dirección o marca el punto en el mapa.'};
  } catch {
    return {status:'UNAVAILABLE',candidates:[],message:'No pudimos consultar el mapa. Conservamos tu dirección; intenta de nuevo o marca el punto de entrega.'};
  }
}
