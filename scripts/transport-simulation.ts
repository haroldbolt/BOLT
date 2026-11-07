/** Creates a NEW isolated copy. Never overwrites an existing environment. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureConfig,fixtureDrivers,fixtureProduct} from '../src/tests/transportFixtures';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=process.argv[2] && path.resolve(process.argv[2]);
if(!target || fs.existsSync(target) || target.startsWith(source+path.sep) || !path.basename(target).includes('simulation')) throw Error('Provide a NEW external directory whose name includes simulation. Existing directories are never modified.');
fs.cpSync(source,target,{recursive:true,filter:entry=>{
 const relative=path.relative(source,entry);const parts=relative.split(path.sep);const name=path.basename(entry);
 return !parts.some(p=>['node_modules','.git','.bolt-private','dist'].includes(p)) && !name.startsWith('persisted-') && !name.startsWith('.env') && name!=='server.js';
}});
if(fs.existsSync(path.join(source,'node_modules'))) fs.symlinkSync(path.join(source,'node_modules'),path.join(target,'node_modules'),'dir');
const products=[fixtureProduct('sim-comida-20kg',20000),fixtureProduct('sim-comida-36kg',36000),fixtureProduct('sim-comida-50kg',50000),fixtureProduct('sim-snack-1kg',1000,'Snacks',true),fixtureProduct('sim-arena-20kg',20000,'Arenas'),fixtureProduct('sim-cama',1000,'Accesorios',true),fixtureProduct('sim-sin-datos',1000),fixtureProduct('sim-unidad-60kg',60000)];
products[5].transport!.bulky=true;products[5].transport!.dimensionsCm=[100,100,100];delete products[6].transport;
const privateDir=path.join(target,'.bolt-private');fs.mkdirSync(privateDir,{recursive:true,mode:0o700});
fs.writeFileSync(path.join(target,'src/data/persisted-catalog-overrides.json'),JSON.stringify({version:'1.0.0',lastUpdated:new Date().toISOString(),customProducts:products,overrides:{},auditLog:[]}));
for(const [file,value] of Object.entries({'persisted-orders.json':[],'persisted-drivers.json':fixtureDrivers,'persisted-audit.json':[],'persisted-telemetry.json':{}})) fs.writeFileSync(path.join(target,'src/data',file),JSON.stringify(value));
fs.writeFileSync(path.join(privateDir,'transport-config.json'),JSON.stringify({config:fixtureConfig(),revision:'simulation-only',audit:[]}),{mode:0o600});
console.log(`Simulation created at ${target}. Start there with PORT=3010 npm run dev. Do not run against the live app.\nFICTITIOUS: Kennedy 3 / Álamos 2 / Suba 3; max 3; cargo 80×60×60 cm. Test-only load 55 kg, packaging 500 g/vehicle + 100 g/unit. No real capacity is asserted.\nUse separate test BOLT_ADMIN_EMAIL/BOLT_ADMIN_PASSWORD variables if you need the protected administration. No credentials or sessions were copied.`);
