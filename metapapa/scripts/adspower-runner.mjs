#!/usr/bin/env node
// Task-scoped JSON-lines runner. First command supplies the API key over stdin.
// No server, credential file, command echo, or unattended worker is created.
import {createInterface} from 'node:readline';
import {resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createAdsPowerApi,publicAdsPowerError} from './adspower.mjs';
import {createMetaClient} from './client.mjs';
import {createCatalogClient} from './catalog.mjs';
import {createFacebookIdClient} from './facebook-id.mjs';
import {createCatalogProductUrlClient,createCatalogProductImageClient,createCatalogProductNameClient} from './catalog-products.mjs';
import {OperationError,redact,atomicJSON} from './lib/common.mjs';

const fail=code=>{throw new OperationError(code);};
export function createAdsPowerRunner({apiFactory=createAdsPowerApi}={}) {
  let api,connection,actorId,mode='read_only';
  const clients=new Map(),products=new Map(),plans=new Map(),catalogs=new Map();
  const page=async id=>{if(!connection)fail('ADSPOWER_NOT_CONNECTED');return connection.getPage(id);};
  async function client(id) {
    const login=await (await page(id)).loginState();
    if(login.status==='challenge_required')fail('LOGIN_OR_CHALLENGE_REQUIRED');
    if(!login.ready)fail('LOGIN_REQUIRED');
    if(actorId&&login.actor_id!==actorId)fail('IDENTITY_CHANGED');
    if(clients.has(id))return clients.get(id);
    const tab=await page(id),result=createMetaClient({cdp:tab.cdp,expectedActorId:actorId,writePolicy:'read_only'});
    const session=await result.inspectSession();
    if(actorId&&session.actor_id!==actorId)fail('IDENTITY_CHANGED');
    actorId=session.actor_id;clients.set(id,result);return result;
  }
  const requireCatalogWrites=()=>{if(mode!=='catalog_write')fail('READ_ONLY_MODE');};
  async function productClient(p) {
    const factory={url:createCatalogProductUrlClient,image:createCatalogProductImageClient,name:createCatalogProductNameClient}[p.field];
    if(!factory)fail('INVALID_PRODUCT_FIELD');
    const readClient=await client(p.readTabId),tab=await page(p.tabId);
    const key=JSON.stringify([p.field,p.tabId,p.readTabId]);
    if(!products.has(key))products.set(key,factory({cdp:tab.cdp,readClient,expectedActorId:actorId}));
    return products.get(key);
  }
  async function close() {
    try{await connection?.disconnect();}finally{api?.dispose();api=undefined;connection=undefined;actorId=undefined;clients.clear();products.clear();plans.clear();catalogs.clear();}
    return {disconnected:true,browser_closed:false};
  }
  async function dispatch(p) {
    if(!p||typeof p!=='object'||Array.isArray(p))fail('INVALID_RUNNER_INPUT');
    if(p.command==='connect'){
      if(connection||api)fail('ADSPOWER_ALREADY_CONNECTED');
      if(!['read_only','catalog_write'].includes(p.mode??'read_only'))fail('INVALID_RUNNER_MODE');
      mode=p.mode??'read_only';actorId=p.expectedActorId;
      try{
        api=apiFactory({baseUrl:p.baseUrl,apiKey:p.apiKey??process.env.METAPAPA_ADSPOWER_API_KEY});
        const status=await api.status(),profiles=await api.profiles({profileId:p.profileId});
        if(profiles.data.length!==1)fail('ADSPOWER_PROFILE_NOT_FOUND');
        connection=await api.attach(p.profileId,{allowStart:p.allowStart===true});
        const tabs=await connection.pages();
        return {status,profile:profiles.data[0],mode,ad_account_writes:'forbidden',started_by_task:connection.started_by_task,tabs:await Promise.all(tabs.map(t=>t.info()))};
      }catch(error){await close();throw error;}
      finally{delete p.apiKey;}
    }
    if(p.command==='disconnect')return close();
    if(!connection)fail('ADSPOWER_NOT_CONNECTED');
    if(p.command==='tabs')return Promise.all((await connection.pages()).map(t=>t.info()));
    if(p.command==='open'){const tab=await connection.newPage(p.url);return tab.info();}
    if(p.command==='navigate'){const tab=await page(p.tabId);clients.delete(p.tabId);return tab.navigate(p.url);}
    if(p.command==='snapshot')return (await page(p.tabId)).snapshot();
    if(p.command==='login_state')return (await page(p.tabId)).loginState();
    if(p.command==='screenshot')return (await page(p.tabId)).screenshot(p.path);
    if(p.command==='session')return (await client(p.tabId)).inspectSession();
    if(p.command==='read'){
      const reader=await client(p.tabId);
      return p.paginate?reader.paginate(p.operation,p.params??{},p.options??{}):reader.query(p.operation,p.params??{});
    }
    if(p.command==='fbid'){
      await client(p.tabId);
      return createFacebookIdClient({cdp:(await page(p.tabId)).cdp,expectedActorId:actorId}).resolve({url:p.url});
    }
    if(p.command==='catalog_open'){
      const tab=await page(p.tabId);await client(p.tabId);
      if(p.manifestPath)requireCatalogWrites();
      const catalog=await createCatalogClient({cdp:tab.cdp,expectedActorId:actorId,catalogId:p.catalogId,businessId:p.businessId,journalPath:p.journalPath,manifestPath:p.manifestPath,resume:p.resume===true});
      const state=await catalog.inspectSession(),key='catalog-'+(catalogs.size+1);catalogs.set(key,catalog);return {handle:key,...state};
    }
    if(p.command==='catalog_call'){
      const catalog=catalogs.get(p.handle);if(!catalog)fail('CATALOG_HANDLE_REQUIRED');
      const reads=['inspectSession','listFeeds','feedDetails','checkResult'];
      const writes=['upload','preview','createFeed','startImport','recordVerified'];
      if(!reads.includes(p.method)&&!writes.includes(p.method))fail('CATALOG_METHOD_REJECTED');
      if(writes.includes(p.method))requireCatalogWrites();
      if(p.args!==undefined&&!Array.isArray(p.args))fail('INVALID_RUNNER_INPUT');
      return catalog[p.method](...(p.args??[]));
    }
    if(p.command==='product_plan'||p.command==='product_restore_plan'){
      requireCatalogWrites();const product=await productClient(p);
      const proposal=p.command==='product_plan'?await product.plan(p.params):await product.planRestore(p.journalPath);
      plans.set(proposal.id,{product,proposal});return proposal;
    }
    if(p.command==='product_execute'){
      requireCatalogWrites();const entry=plans.get(p.planId);
      if(!entry||p.authorizedPlanId!==p.planId)fail('PLAN_NOT_AUTHORIZED');
      plans.delete(p.planId);return entry.product.execute(entry.proposal,{authorizedPlanId:p.authorizedPlanId,journalPath:p.journalPath});
    }
    if(p.command==='product_reconcile')return (await productClient(p)).reconcile(p.journalPath);
    if(p.command==='ui_link')return (await page(p.tabId)).clickLink(p.selector);
    if(['ui_catalog_create_click','ui_catalog_create_fill'].includes(p.command)){
      requireCatalogWrites();if(!actorId)fail('LOGIN_IDENTITY_REQUIRED');
      const tab=await page(p.tabId),authorization={kind:'catalog_create',expectedActorId:actorId,businessId:p.businessId};
      if(p.command==='ui_catalog_create_click')return tab.creatorClick(p.selector,authorization);
      return tab.creatorFill(p.selector,p.value,authorization);
    }
    if(['ui_click','ui_fill','ui_upload'].includes(p.command)){
      requireCatalogWrites();if(!actorId)fail('LOGIN_IDENTITY_REQUIRED');
      const tab=await page(p.tabId),authorization={kind:'catalog_write',expectedActorId:actorId,catalogId:p.catalogId};
      if(p.command==='ui_click')return tab.click(p.selector,authorization);
      if(p.command==='ui_fill')return tab.fill(p.selector,p.value,authorization);
      return tab.upload(p.selector,p.path,authorization);
    }
    // No arbitrary evaluate, ad mutation, raw HTTP, browser.close or policy escalation command.
    fail('RUNNER_COMMAND_UNAVAILABLE');
  }
  return {dispatch,close};
}

export async function main() {
  const runner=createAdsPowerRunner();
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  const shutdown=async()=>{lines.close();await runner.close();};
  process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
  try{
    for await(const line of lines){
      let p;
      try{
        if(line.length>1024*1024)fail('RUNNER_INPUT_TOO_LARGE');
        p=JSON.parse(line);const result=await runner.dispatch(p);
        if(p.outputPath){await atomicJSON(p.outputPath,result);process.stdout.write(JSON.stringify({ok:true,output_path:p.outputPath})+'\n');}
        else process.stdout.write(JSON.stringify({ok:true,result:redact(result)})+'\n');
      }catch(error){process.stdout.write(JSON.stringify(publicAdsPowerError(error))+'\n');}
    }
  }finally{await runner.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolvePath(process.argv[1])).href)await main();
