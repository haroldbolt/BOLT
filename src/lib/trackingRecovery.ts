import crypto from 'node:crypto';
import type {Express,Request,Response,NextFunction} from 'express';
import type {OrdersRepository} from './ordersRepository';
import {DispatchService,DispatchError} from './dispatchService';
export interface RecoveryCase {id:string;orderId?:string;reference:string;secretHash:string;createdAt:number;expiresAt:number;status:'PENDING'|'APPROVED'|'REJECTED';review?:{actorId:string;at:number;method:string;reference:string};}
const hash=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
const equal=(a:string,b:string)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class TrackingRecovery {
 constructor(private repo:OrdersRepository,private dispatch:DispatchService,private now=()=>Date.now()){}
 private cases(){return this.repo.dispatchState.recoveries||{};}
 begin(input:{id:string;reference:string;secret:string}){
  if(!/^[a-f\d-]{36}$/i.test(input?.id||'')||!/^\w[\w -]{2,149}$/.test(input?.reference||'')||! /^[a-f\d]{64}$/i.test(input?.secret||''))throw new DispatchError(400,'INVALID_RECOVERY','Referencia o solicitud inválida.');
  return this.repo.transaction(()=>{
   const cases=this.repo.dispatchState.recoveries ||= {},prior=cases[input.id];
   if(prior){if(!equal(prior.secretHash,hash(input.secret))||prior.reference!==input.reference)throw new DispatchError(409,'RECOVERY_CONFLICT','La solicitud ya existe.');return {id:prior.id,status:'PENDING'};}
   for(const [id,c] of Object.entries(cases))if(c.expiresAt<this.now())delete cases[id];
   if(Object.keys(cases).length>=1000)throw new DispatchError(429,'RECOVERY_BUSY','Intenta nuevamente más tarde.');
   const order=this.repo.getAllOrders().find(o=>o.id===input.reference||o.orderNumber===input.reference||o.purchaseCode===input.reference);
   cases[input.id]={id:input.id,reference:input.reference,orderId:order?.id,secretHash:hash(input.secret),createdAt:this.now(),expiresAt:this.now()+86400000,status:'PENDING'};
   return {id:input.id,status:'PENDING'};
  });
 }
 status(input:{id:string;secret:string}){
  const c=this.cases()[input?.id];
  if(!c||c.expiresAt<=this.now()||typeof input.secret!=='string'||!equal(c.secretHash,hash(input.secret)))throw new DispatchError(403,'RECOVERY_ACCESS_REQUIRED','Solicitud no disponible. Inicia una recuperación asistida.');
  if(c.status!=='APPROVED')return {id:c.id,status:c.status};
  const o=this.repo.getOrderById(c.orderId!)!;
  return {id:c.id,status:c.status,orderId:o.id,guestAccessToken:this.dispatch.guestToken(o)};
 }
 list(){return Object.values(this.cases()).filter(c=>c.expiresAt>this.now()).map(({id,orderId,reference,status,createdAt,review})=>({id,orderId,reference,status,createdAt,review}));}
 approve(id:string,input:{method:string;evidenceReference:string;transactionReference?:string;verifiedOwner:boolean},actorId:string){
  return this.repo.transaction(()=>{
   const c=this.cases()[id],o=c?.orderId?this.repo.getOrderById(c.orderId):undefined;
   if(!c||!o||c.expiresAt<=this.now())throw new DispatchError(409,'RECOVERY_UNRESOLVED','Identifica el pedido y verifica al titular antes de autorizar.');
   if(input.verifiedOwner!==true||!['PAYMENT_RECEIPT_REVIEW','IN_PERSON_DOCUMENT_REVIEW'].includes(input.method)||!/^CASE-[\w.-]{6,100}$/.test(input.evidenceReference||''))throw new DispatchError(400,'OWNERSHIP_EVIDENCE_REQUIRED','Requiere comprobante original o revisión presencial del titular y referencia CASE- del expediente verificado. Un nombre, correo o teléfono no bastan.');
   if(input.method==='PAYMENT_RECEIPT_REVIEW' && (!o.payment.transactionId||input.transactionReference!==o.payment.transactionId))throw new DispatchError(409,'PAYMENT_EVIDENCE_MISMATCH','El comprobante no coincide con la transacción guardada. Utiliza revisión presencial si no existe ese dato.');
   if(c.status==='APPROVED'){
    if(c.review?.method!==input.method||c.review.reference!==input.evidenceReference)throw new DispatchError(409,'RECOVERY_CONFLICT','Ya fue autorizada con otra evidencia.');
    return {approved:true,replayed:true};
   }
   if(c.status!=='PENDING')throw new DispatchError(409,'RECOVERY_CLOSED','Solicitud cerrada.');
   this.repo.dispatchState.guestSecret ||= crypto.randomBytes(32).toString('base64url');
   this.repo.dispatchState.guestHashes[o.id]=hash(this.dispatch.guestToken(o));
   c.status='APPROVED';c.review={actorId,at:this.now(),method:input.method,reference:input.evidenceReference};
   this.repo.dispatchState.events.push({id:crypto.randomUUID(),type:'TRACKING_ACCESS_RECOVERED',actorId,at:this.now(),detail:JSON.stringify({caseId:id,orderId:o.id,method:input.method,evidenceReference:input.evidenceReference})});
   return {approved:true};
  });
 }
}
export function mountTrackingRecovery(app:Express,repo:OrdersRepository,dispatch:DispatchService,admin:(req:Request,res:Response,next:NextFunction)=>unknown){
 const service=new TrackingRecovery(repo,dispatch),limits=new Map<string,{count:number;until:number}>();
 const handler=(fn:(req:Request)=>unknown)=>(req:Request,res:Response)=>{res.set('Cache-Control','no-store');try{res.json(fn(req));}catch(e){if(e instanceof DispatchError)res.status(e.status).json({code:e.code,error:e.message});else res.status(500).json({error:'No se pudo completar la recuperación.'});}};
 app.use('/api/v1/tracking-recovery',(req,res,next)=>{
  const key=hash(req.ip||'unknown'),old=limits.get(key),now=Date.now();
  const current=old&&old.until>now?old:{count:0,until:now+3600000};
  if(++current.count>240)return res.status(429).json({error:'Demasiadas consultas. Intenta más tarde.'});
  if(limits.size>10000)limits.clear();limits.set(key,current);next();
 });
 app.post('/api/v1/tracking-recovery',handler(req=>service.begin(req.body)));
 app.post('/api/v1/tracking-recovery/status',handler(req=>service.status(req.body)));
 app.get('/api/v1/admin/dispatch/recoveries',admin,handler(()=>service.list()));
 app.post('/api/v1/admin/dispatch/recoveries/:id/approve',admin,handler(req=>service.approve(req.params.id,req.body,(req as any).adminSession.userId)));
}
