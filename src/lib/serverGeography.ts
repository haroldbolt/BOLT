import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeBogotaLocality } from './territoryConfig';
import { validDestinationCoordinates } from './addressGeography';

const read = (name: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/data/geography', name + '.json'), 'utf8')).features;
const localities = read('localities');
const urbanSoil = read('urban-soil');
const soachaUrban = read('soacha-urban');

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
export function enrichDestination<T extends {coordinates?: any; municipality?: string; locality?: string}>(destination: T): T & { geographicExclusion?: string; locality?: string; municipality?: string } {
  if (!destination || !validDestinationCoordinates(destination.coordinates)) return destination;
  const feature = localities.find((f: any)=>inGeometry(destination.coordinates,f.geometry));
  if (feature) {
    const locality = canonicalizeBogotaLocality(feature.properties.name)!;
    const urban = urbanSoil.some((f: any)=>inGeometry(destination.coordinates,f.geometry));
    return {...destination, municipality:'Bogotá D.C.', locality,
      geographicExclusion: locality === 'Sumapaz' ? 'Sumapaz queda fuera de la cobertura estándar inicial.'
        : !urban ? 'El destino está en suelo rural o de expansión, fuera de la cobertura urbana habilitada.' : undefined};
  }
  // Preserve the already configured Soacha service zone, intersected with
  // official urban land-use polygons. Never infer Soacha from a barrio name.
  const {lat,lng}=destination.coordinates;
  const inEnabledSoachaZone=lat>=4.540 && lat<=4.605 && lng>=-74.240 && lng<=-74.195;
  if(inEnabledSoachaZone && soachaUrban.some((f:any)=>inGeometry(destination.coordinates,f.geometry))) {
    return {...destination, municipality:'Soacha', locality:undefined, geographicExclusion:undefined};
  }
  return {...destination, locality:undefined, geographicExclusion:'El punto de entrega está fuera del territorio urbano habilitado de Bogotá y Soacha.'};
}
