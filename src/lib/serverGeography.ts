import { COVERAGE_MUNICIPALITIES, COVERAGE_NOTICE } from '../data/coverageConfig';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeBogotaLocality } from './territoryConfig';
import { validDestinationCoordinates } from './addressGeography';

const read = (name: string) => {
  const {features}=JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/data/geography', name + '.json'), 'utf8'));
  if(!features?.length || features.some((f:any)=>!f.geometry || !['Polygon','MultiPolygon'].includes(f.geometry.type))) throw Error('Geografía incompleta: '+name);
  return features;
};
const localities = read('localities');
const urbanSoil = read('urban-soil');
const soachaUrban = read('soacha-urban');
const municipalities=read('municipalities');
const northernUrban=read('northern-urban');

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    if (((yi>y)!==(yj>y)) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
export function inGeometry(coords: {lat:number;lng:number}, geometry: any): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings: number[][][]) => inRing(coords.lng,coords.lat,rings[0])
    && !rings.slice(1).some(ring=>inRing(coords.lng,coords.lat,ring)));
}

// Server-owned offline snapshots of official geometry; no phone location, text
// heuristics, external lookups or warehouse distances determine the locality.
export function enrichDestination<T extends {coordinates?: any; municipality?: string; locality?: string}>(destination: T): T & { geographicExclusion?: string; locality?: string; municipality?: string; municipalityCode?:string; countryCode?:string } {
  if(!destination) return destination;
  // Discard client assertions, including exclusion flags and administrative IDs.
  const clean={...destination,municipality:undefined,locality:undefined,geographicExclusion:undefined,municipalityCode:undefined,countryCode:undefined};
  if(!validDestinationCoordinates(destination.coordinates)) return clean;
  const point=destination.coordinates;
  const localityFeature=localities.find((f:any)=>inGeometry(point,f.geometry));
  const municipalityFeature=municipalities.find((f:any)=>inGeometry(point,f.geometry));
  const code=localityFeature ? '11001' : municipalityFeature?.properties.MPIO_CDPMP;
  const policy=COVERAGE_MUNICIPALITIES.find(m=>m.code===code);
  const resolved={...clean,municipality:policy?.name || municipalityFeature?.properties.MPIO_CNMBRE,municipalityCode:code,countryCode:code ? 'CO' : undefined};
  if(!policy?.active) return {...resolved,geographicExclusion:COVERAGE_NOTICE.message};
  const locality=localityFeature ? canonicalizeBogotaLocality(localityFeature.properties.name) || undefined : undefined;
  if(locality==='Sumapaz') return {...resolved,locality,geographicExclusion:'Sumapaz queda fuera de la cobertura estándar inicial.'};
  const b=policy.bounds;
  const withinBounds=!b || (point.lat>=b.minLat && point.lat<=b.maxLat && point.lng>=b.minLng && point.lng<=b.maxLng);
  const features=policy.zone==='BOGOTA_URBAN' ? urbanSoil : policy.zone==='SOACHA_ENABLED_URBAN' ? soachaUrban : northernUrban.filter((f:any)=>f.properties.MPIO_CDPMP===code);
  const urban=withinBounds && features.some((f:any)=>inGeometry(point,f.geometry));
  return {...resolved,locality,geographicExclusion:urban ? undefined : 'El destino está fuera de la zona urbana habilitada de este municipio. Las zonas rurales o de expansión permanecen excluidas.'};
}
