import {randomUUID} from 'node:crypto';
import {createTransport} from './lib/transport.mjs';
import {OperationError,redact,digest,createJournal,readJournal,stamp,atomicJSON} from './lib/common.mjs';
import {capabilities,buildOperation,operation} from './lib/operations.mjs';
import './lib/graphql.mjs';
import {normalizeWritePolicy,assertWriteAllowed} from './lib/write-policy.mjs';
import {browserContext,assertBrowserContext} from './lib/browser-context.mjs';
export {capabilities,readJournal};

export function createMetaClient({cdp,expectedActorId,writePolicy='no_ad_account_writes'}={}){
 writePolicy=normalizeWritePolicy(writePolicy);
 const context=browserContext(cdp);
 const transport=createTransport(cdp),plans=new Map();
 let session;
 async function inspectSession(){assertBrowserContext(context,browserContext(cdp));session=await transport.session();if(expectedActorId&&session.actor_id!==expectedActorId)throw new OperationError('IDENTITY_CHANGED');return session;}
 async function ensureSession(){if(!session)await inspectSession();return session;}
 async function query(name,params={}){
  const current=await ensureSession(),{op,request}=buildOperation(name,params,current);
  if(op.write)throw new OperationError('WRITE_REQUIRES_PLAN','Use plan() followed by execute() for mutations.');
  const result=await transport.request(request);
  return {operation:name,actor_id:current.actor_id,fetched_at:stamp(),data:result.data,pagination:op.paginated?result.pagination:{complete:false,reason:'Single response; inspect nested connection cursors where present.'}};
 }
 async function paginate(name,params={},options={}){
  if(!operation(name).paginated)throw new OperationError('PAGINATION_UNAVAILABLE');
  const maxPages=options.maxPages??20,delayMs=options.delayMs??350;
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>500||delayMs<0||delayMs>30000)throw new OperationError('INVALID_INPUT');
  let after=params.after;const seen=new Set(),data=[];let pages=0;
  while(pages<maxPages){
   if(options.signal?.aborted)return {operation:name,data,pages,complete:false,reason:'cancelled',cursor:after};
   let response;
   try{response=await query(name,{...params,...(after?{after}:{})});}
   catch(e){return {operation:name,data,pages,complete:false,reason:'request_failed',cursor:after,error:{code:e.code||'UNKNOWN',details:redact(e.details)}};}
   if(!Array.isArray(response.data?.data))return {operation:name,data,pages,complete:false,reason:'schema_changed'};
   data.push(...response.data.data);pages++;
   if(!response.pagination.has_more)return {operation:name,actor_id:session.actor_id,data,pages,complete:true};
   after=response.pagination.after;
   if(!after||seen.has(after))return {operation:name,data,pages,complete:false,reason:'cursor_missing_or_repeated',cursor:after};
   seen.add(after);if(pages<maxPages&&delayMs)await new Promise(r=>setTimeout(r,delayMs));
  }
  return {operation:name,data,pages,complete:false,reason:'page_limit',cursor:after};
 }
 async function plan(name,params={}){
  assertWriteAllowed(operation(name),writePolicy);
  const current=await inspectSession();const {op,request}=buildOperation(name,params,current);
  if(!op.write)throw new OperationError('READ_OPERATION','Use query() for this capability.');
  const id=randomUUID();const result={id,operation:name,description:op.description,actor_id:current.actor_id,browser_context:context,params:structuredClone(params),request:redact(request),created_at:stamp(),verification:op.verification};
  result.digest=digest(result);plans.set(id,{plan:structuredClone(result),request,params:structuredClone(params)});return result;
 }
 async function execute(proposal,{authorizedPlanId,journalPath}={}){
  const stored=plans.get(proposal?.id);
  if(!stored||authorizedPlanId!==proposal.id||!journalPath||JSON.stringify(stored.plan)!==JSON.stringify(proposal))throw new OperationError('PLAN_NOT_AUTHORIZED','Use the exact reviewed plan and a unique task journal path.');
  assertWriteAllowed(operation(stored.plan.operation),writePolicy);
  // Consume synchronously before the first await: concurrent callers must not submit twice.
  plans.delete(proposal.id);
  await inspectSession();if(session.actor_id!==proposal.actor_id)throw new OperationError('IDENTITY_CHANGED');
  const journal=await createJournal(journalPath,{operation:proposal.operation,plan_id:proposal.id,actor_id:proposal.actor_id,browser_context:context,params:stored.params,request_fingerprint:digest(stored.request)});
  await journal.record('attempting');
  let response;
  try{response=await transport.request(stored.request);}
  catch(e){await journal.record(e.details?.submitted===false?'not_submitted':'unknown',{code:e.code||'UNKNOWN',details:e.details});throw e;}
  await journal.record('response_received',{response_keys:Object.keys(response.data||{}),result_id:response.data?.id});
  const op=operation(proposal.operation);let verification={status:'requires_business_verification'};
  if(op.verify){
   const check=op.verify(stored.params);
   try{
    const read=await query(check.operation,check.params);
    const matches=Object.entries(check.expected).every(([k,v])=>String(read.data?.[k])===String(v));
    verification={status:matches?'verified':'mismatch',observed:Object.fromEntries(Object.keys(check.expected).map(k=>[k,read.data?.[k]])),expected:check.expected};
   }catch(e){verification={status:'readback_failed',code:e.code};}
  }
  await journal.record(verification.status==='verified'?'complete':'needs_verification',{verification});
  return {operation:proposal.operation,actor_id:session.actor_id,data:response.data,verification,journal_path:journalPath};
 }
 async function reconcile(journalPath){
  const journal=await readJournal(journalPath);await inspectSession();
  assertBrowserContext(journal.browser_context,context);
  if(journal.actor_id!==session.actor_id)throw new OperationError('IDENTITY_CHANGED');
  const op=operation(journal.operation);
  if(op.verify){const check=op.verify(journal.params);const result=await query(check.operation,check.params);return {journal:journal.state,readback:result,expected:check.expected,replayed:false};}
  return {journal:journal.state,operation:journal.operation,params:journal.params,replayed:false,next:'Query the exact affected assets or open their result page before any new submission.'};
 }
 return {inspectSession,capabilities,query,paginate,plan,execute,reconcile,writePolicy,browserContext:context,async exportResult(path,result){await atomicJSON(path,result);return {path};}};
}
