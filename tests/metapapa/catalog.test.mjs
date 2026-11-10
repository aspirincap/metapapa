import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCatalogClient} from '../../metapapa/scripts/catalog.mjs';
async function fixture({failImport=false,previewError=false}={}){
 const folder=await mkdtemp(join(tmpdir(),'catalog-test-')),csv=join(folder,'products.csv'),manifestPath=join(folder,'manifest.json'),journalPath=join(folder,'journal.json');const bytes=Buffer.from('id,title\nSKU-01,Product\n');await writeFile(csv,bytes);
 await writeFile(manifestPath,JSON.stringify({errors:[],ids:['SKU-01'],row_count:1,upload_path:csv,upload_filename:'products.csv',upload_bytes:bytes.length,upload_sha256:createHash('sha256').update(bytes).digest('hex'),default_currency:'USD',currencies:['USD']}));
 const calls=[];
 const ctx=vm.createContext({URL,URLSearchParams,AbortSignal,FormData,File,Uint8Array,atob,location:{origin:'https://business.facebook.com',href:'https://business.facebook.com/commerce/catalogs/333/?business_id=222',pathname:'/commerce/catalogs/333/'},require:n=>({CurrentUserInitialData:{USER_ID:'111'},getAsyncParams:()=>({}),DTSGInitialData:{token:'private'},LSD:{token:'private'}}[n]),fetch:async(url,init)=>{
  const q=new URLSearchParams(typeof init.body==='string'?init.body:'');const name=q.get('fb_api_req_friendly_name');calls.push(name||'upload');let body;
  if(!name)body={payload:{meta:'private-upload-handle'}};
  else if(name==='useCatalogFeedPreviewQuery')body={data:{catalog:{feedPreview:{is_preview_supported:true,parser_results:[{properties:[{key:'id',value:'SKU-01'}],errors:previewError?[{error_details:{description:'Invalid image'}}]:[]}],errors:[],missing_properties:[],invalid_columns:[]}}}};
  else if(name==='useCreatePrimaryProductFeedMutation')body={data:{create_primary_product_feed:{product_feed:{id:'444'}}}};
  else if(name==='useCreateProductFeedUploadSessionMutation'){if(failImport)throw Error('network');body={data:{create_product_feed_upload_session:{product_feed_upload_session_id:'555'}}};}
  else if(name==='CatalogDataSourcesUnifiedDetailsPageQuery')body={data:{catalog:{id:'333'},dataSource:{id:'444',name:'feed',data_source_status:'ACTIVE',product_count:1,last_update_time:123,latest_upload:{id:'555'}}}};
  else body={data:{catalog:{id:'333',data_sources_v2:{nodes:[{id:'444',name:'feed'}]}}}};
  return {status:200,url, text:async()=>JSON.stringify(body)};
 }});
 const cdp={async send(_,p){try{return {result:{value:JSON.parse(JSON.stringify(await vm.runInContext(p.expression,ctx)))}};}catch{return {exceptionDetails:{text:'suppressed'}};}}};
 const config={cdp,catalogId:'333',businessId:'222',manifestPath,journalPath,expectedActorId:'111'};return {config,folder,manifestPath,journalPath,calls,client:await createCatalogClient(config)};
}
test('catalog upload, preview, import, result, and UI evidence lifecycle',async()=>{const f=await fixture();await f.client.upload();assert((await f.client.preview()).ok);await f.client.createFeed({name:'Test'});await f.client.startImport();assert.equal((await f.client.checkResult()).outcome,'count_matched_verify_ui');await assert.rejects(f.client.recordVerified({feedId:'444',productCount:1,uiStatus:'All good'}),/UI_EVIDENCE_REQUIRED/);const evidence=join(f.folder,'ui.txt');await writeFile(evidence,'mock UI evidence');await f.client.recordVerified({feedId:'444',productCount:1,uiStatus:'All good',evidencePath:evidence});const j=await readFile(f.journalPath,'utf8');assert.equal(JSON.parse(j).state,'complete');assert(!j.includes('private-upload-handle'));assert.equal(JSON.parse(j).actor_id,'111');await assert.rejects(f.client.startImport(),/NO_AUTOMATIC_REPLAY/);});
test('preview issues block feed creation',async()=>{const f=await fixture({previewError:true});await f.client.upload();assert(!(await f.client.preview()).ok);await assert.rejects(f.client.createFeed({name:'x'}),/PREVIEW_NOT_PASSED/);assert(!f.calls.includes('useCreatePrimaryProductFeedMutation'));});
test('changed CSV blocked before upload',async()=>{const f=await fixture();const manifest=JSON.parse(await readFile(f.manifestPath,'utf8'));await writeFile(manifest.upload_path,'changed');await assert.rejects(f.client.upload(),/CSV_CHANGED/);assert.equal(f.calls.length,0);});
test('resume reconciles confirmed import and cannot replay mutations',async()=>{const f=await fixture();await f.client.upload();await f.client.preview();await f.client.createFeed({name:'Test'});await f.client.startImport();const resumed=await createCatalogClient({...f.config,manifestPath:undefined,resume:true});assert.equal((await resumed.checkResult()).outcome,'count_matched_verify_ui');await assert.rejects(resumed.upload(),/validated manifestPath/);await assert.rejects(resumed.createFeed({name:'again'}),/PREVIEW_NOT_PASSED/);assert.equal(f.calls.filter(x=>x==='useCreatePrimaryProductFeedMutation').length,1);});
test('uncertain import is recorded and never automatically resubmitted',async()=>{const f=await fixture({failImport:true});await f.client.upload();await f.client.preview();await f.client.createFeed({name:'Test'});await assert.rejects(f.client.startImport(),/UNCONFIRMED/);assert.equal(JSON.parse(await readFile(f.journalPath,'utf8')).state,'start_import:unconfirmed');await assert.rejects(f.client.startImport(),/NO_AUTOMATIC_REPLAY/);});
test('journal collision prevents second upload',async()=>{const f=await fixture();await f.client.upload();const other=await createCatalogClient(f.config);await assert.rejects(other.upload(),/JOURNAL_ALREADY_EXISTS/);assert.equal(f.calls.filter(x=>x==='upload').length,1);});
