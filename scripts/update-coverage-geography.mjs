import fs from 'node:fs/promises';
import path from 'node:path';
const sources=[
 {name:'localities',url:'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/mapa_base_3857/MapServer/4',min:20,transform:f=>({type:'Feature',properties:{name:f.properties.LOCNOMBRE},geometry:f.geometry})},
 {name:'urban-soil',url:'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/ordenamientoterritorial/suelo/MapServer/0',min:1,filter:f=>f.properties.SUECSUELO===1,transform:f=>({type:'Feature',properties:{soilClass:1},geometry:f.geometry})},
 {name:'soacha-urban',url:'https://services7.arcgis.com/lsxbLWF2l19Rmhqj/arcgis/rest/services/7_2_Uso_suelo_urbano_magna/FeatureServer/0',min:1,transform:f=>f},
 {name:'municipalities',url:'https://portalgis.dane.gov.co/mparcgis/rest/services/Divipola/Serv_DIVIPOLA_MGN_2024/FeatureServer/317',min:10,where:"MPIO_CDPMP IN ('11001','25754','25175','25126','25214','25430','25286','25473','25740','25899')",transform:f=>f},
 {name:'northern-urban',url:'https://portalgis.dane.gov.co/mparcgis/rest/services/Divipola/Serv_DIVIPOLA_MGN_2024/FeatureServer/305',min:2,where:"MPIO_CDPMP IN ('25175','25126')",filter:f=>f.properties.CLAS_CCDGO==='1',transform:f=>f},
];
const downloads=[];
for(const source of sources){
 const params=new URLSearchParams({where:source.where || '1=1',outFields:'*',outSR:'4326',f:'geojson',returnGeometry:'true'});
 const response=await fetch(source.url+'/query?'+params,{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(source.name+' HTTP '+response.status);
 const data=await response.json();
 if(data.error || data.exceededTransferLimit || data.properties?.exceededTransferLimit || !Array.isArray(data.features) || !data.features.length)throw Error('Invalid/truncated geography: '+source.name);
 const features=data.features.filter(source.filter || (()=>true)).map(source.transform);
 if(features.length<source.min || features.some(f=>!['Polygon','MultiPolygon'].includes(f.geometry?.type)))throw Error('Unexpected geometry: '+source.name);
 if(source.name==='localities' && (features.length!==20 || features.some(f=>!f.properties.name)))throw Error('Expected 20 named localities');
 downloads.push({name:source.name,data:JSON.stringify({type:'FeatureCollection',features,source:{url:source.url+'/query?'+params,publisher:source.url.includes('dane.gov.co')?'DANE':'See source URL',retrievedAt:new Date().toISOString()}})});
}
const dir=path.resolve('src/data/geography');
for(const download of downloads)await fs.writeFile(path.join(dir,download.name+'.json'),download.data+'\n');
console.log('Updated geography:',downloads.map(d=>d.name).join(', '));
