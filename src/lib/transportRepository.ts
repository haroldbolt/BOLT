import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DriverProfile, Store } from '../types';
import { DEFAULT_TRANSPORT_CONFIG, type TransportConfig } from '../types/transport';
import { validateTransportConfig } from './transportPlanner';
export class TransportRepository {
  constructor(private file=path.join(process.cwd(),'.bolt-private','transport-config.json')) {}
  read(): {config:TransportConfig; revision:string; audit:any[]} {
    if(!fs.existsSync(this.file)) return {config:structuredClone(DEFAULT_TRANSPORT_CONFIG),revision:'initial',audit:[]};
    // Invalid configuration fails closed instead of enabling guessed capacities.
    return JSON.parse(fs.readFileSync(this.file,'utf8'));
  }
  update(config:TransportConfig, expectedRevision:string, actor:{email:string;name:string}, drivers:DriverProfile[], stores:Store[]) {
    const old=this.read(); if(old.revision!==expectedRevision) throw Error('La configuración cambió. Recarga antes de guardar.');
    validateTransportConfig(config,drivers,stores.map(s=>s.id));
    const next={config,revision:crypto.randomUUID(),audit:[...old.audit,{at:new Date().toISOString(),actor,before:old.config,after:config}]};
    fs.mkdirSync(path.dirname(this.file),{recursive:true}); const temp=this.file+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(next,null,2),{mode:0o600});fs.renameSync(temp,this.file);return next;
  }
}
