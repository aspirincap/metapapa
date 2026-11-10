import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCatalogProductUrlClient,createCatalogProductImageClient,createCatalogProductNameClient} from '../../metapapa/scripts/catalog-products.mjs';

const operations={useCatalogItemsByIdsQuery:{name:'useCatalogItemsByIdsQuery',id:'28858660767135028',operationKind:'query'},CatalogBulkItemEditorHooksBulkItemUpdateMutation:{name:'CatalogBulkItemEditorHooksBulkItemUpdateMutation',id:'29601050282817196',operationKind:'mutation'}};
function fixture(options={}) {
 const state={actor:'111',catalog:'222',writes:[],queryCount:0,rows:['444','445'].map((id,i)=>({__typename:'ProductItem',id,fbProductCategory:'',productFeed:{id:'333'},partnerIntegrationDetails:null,attributes:[{name:'RetailerID',stringValue:`SKU-${i+1}`},{name:'ProductURL',urlValue:`https://old.example/${i+1}`},{name:'Price',priceValue:{amount:'10.00',currency:'USD'}}]}))};
 state.rows.forEach((row,i)=>{
  row.attributes.push({name:'Name',stringValue:`Product ${i+1}`});
  row.images=[{id:String(800+i),uri:`https://cdn.example/${i}`}];row.videos=[];
  row.graph={id:row.id,retailer_id:`SKU-${i+1}`,url:`https://old.example/${i+1}`,image_url:`https://images.example/original-${i+1}.jpg`,price:'$10.00',name:`Product ${i+1}`};
 });
 const context=vm.createContext({URL,URLSearchParams,AbortSignal,location:{origin:'https://business.facebook.com',href:'https://business.facebook.com/commerce/catalogs/222/products'},
  require(name){
   if(name==='CurrentUserInitialData')return {USER_ID:state.actor};
   if(name==='DTSGInitialData'||name==='LSD')return {token:'secret-session-value'};
   if(name==='getAsyncParams')return ()=>({});
   if(name.endsWith('.graphql')){const p=operations[name.slice(0,-8)];if(!p)throw Error('missing');return {params:{...p,...(options.protocolChanged?{id:'999'}:{})}};}
   throw Error('missing');
  },async fetch(endpoint,request){
   const form=new URLSearchParams(request.body),variables=JSON.parse(form.get('variables'));
   let data;
   if(form.get('fb_api_req_friendly_name')==='useCatalogItemsByIdsQuery'){
    state.queryCount++;if(options.readbackFails&&state.writes.length)throw Error('offline');
    data={data:{nodes:variables.ids.map(id=>structuredClone(state.rows.find(r=>r.id===id)))}};
   }else{
    state.writes.push({endpoint,variables});
    if(options.failBeforeResponse)throw Error('offline');
    for(const item of variables.input.item_data){
     const row=state.rows.find(r=>r.attributes.find(a=>a.name==='RetailerID').stringValue===item.base_fields_data.id);
     if(options.partial&&row.id==='445')continue;
     if(options.imageMode){
      if(!options.imageDelayed){row.graph.image_url=item.extended_fields_data.find(f=>f.field_name==='image_link').field_value.value_string;row.images=[{id:String(Number(row.images[0].id)+1000),uri:'https://cdn.example/new'}];}
      if(options.extraMediaAfterWrite)row.videos=[{id:'999'}];
      if(options.graphSideEffect)row.graph.price='$99.00';
     }else if(options.nameMode){
      row.attributes.find(a=>a.name==='Name').stringValue=item.base_fields_data.title;
      if(!options.nameMismatch)row.graph.name=item.base_fields_data.title;
      if(options.graphSideEffect)row.graph.image_url='https://unexpected.example/image.jpg';
     }else row.attributes.find(a=>a.name==='ProductURL').urlValue=item.base_fields_data.link;
     if(options.sideEffect)row.attributes.find(a=>a.name==='Price').priceValue.amount='99.00';
    }
    if(options.lostResponseAfterCommit)throw Error('lost response');
    data={data:{bulk_update_items:{success:!options.partial,created_items:0,updated_items:options.partial?1:variables.input.item_data.length,errors:options.partial?[{retailer_id:'SKU-2',type:'VALIDATION',message:'Rejected'}]:[]}}};
   }
   return {ok:true,status:200,text:async()=>JSON.stringify(data)};
  }});
 const cdp={async send(method,params){assert.equal(method,'Runtime.evaluate');return {result:{value:JSON.parse(JSON.stringify(await vm.runInContext(params.expression,context)))}};}};
 const readClient={async inspectSession(){return {actor_id:state.actor};},async paginate(){return {complete:!options.incompleteCatalog,data:state.rows.map(r=>({id:r.id,retailer_id:r.attributes.find(a=>a.name==='RetailerID').stringValue}))};},async query(name,{productId}){assert.equal(name,'catalogs.products.get');return {data:structuredClone(state.rows.find(r=>r.id===productId).graph)};}};
 const client=(options.imageMode?createCatalogProductImageClient:options.nameMode?createCatalogProductNameClient:createCatalogProductUrlClient)({cdp,readClient,expectedActorId:'111'});
 const input={catalogId:'222',feedId:'333',updates:state.rows.map((r,i)=>({productId:r.id,retailerId:`SKU-${i+1}`,[options.imageMode?'imageUrl':options.nameMode?'name':'url']:options.nameMode?'测试背包 · 新名称':'https://new.example'}))};
 return {client,state,input};
}
async function journal(){return join(await mkdtemp(join(tmpdir(),'catalog-url-test-')),'journal.json');}
test('one batch uses retailer SKU and link only; checks every readback and records no credentials',async()=>{
 const {client,state,input}=fixture(),p=await client.plan(input),path=await journal();
 const r=await client.execute(p,{authorizedPlanId:p.id,journalPath:path});
 assert.equal(r.status,'verified');assert.equal(state.writes.length,1);
 assert.deepEqual(state.writes[0].variables.input.item_data,[{base_fields_data:{id:'SKU-1',link:'https://new.example/'},extended_fields_data:[],item_sub_type:null},{base_fields_data:{id:'SKU-2',link:'https://new.example/'},extended_fields_data:[],item_sub_type:null}]);
 assert.equal(r.verification.items.length,2);assert.ok(!String(await readFile(path)).includes('secret-session-value'));
});
test('already-correct URLs are a no-op with zero mutation requests',async()=>{
 const {client,state,input}=fixture();input.updates.forEach((x,i)=>x.url=`https://old.example/${i+1}`);
 const p=await client.plan(input),r=await client.execute(p,{authorizedPlanId:p.id,journalPath:await journal()});
 assert.equal(p.skipped,2);assert.equal(r.submitted,false);assert.equal(state.writes.length,0);
});
test('rejects duplicate IDs/SKUs, invalid URLs, unsupported fields and incomplete catalog reads',async()=>{
 for(const tweak of [x=>x.updates[1].productId='444',x=>x.updates[1].retailerId='SKU-1',x=>x.updates[0].url='javascript:alert(1)',x=>x.updates[0].url='https://user:pass@example.com',x=>x.updates[0].price=123]){
  const f=fixture();tweak(f.input);await assert.rejects(f.client.plan(f.input));assert.equal(f.state.writes.length,0);
 }
 const f=fixture({incompleteCatalog:true});await assert.rejects(f.client.plan(f.input),{code:'INCOMPLETE_CATALOG'});
});
test('requires matching catalog, SKU, Feed and observed empty-category route',async()=>{
 for(const [tweak,code] of [
  [f=>f.input.catalogId='999','CATALOG_PAGE_MISMATCH'],[f=>f.input.updates[0].retailerId='wrong','CATALOG_MEMBERSHIP_MISMATCH'],
  [f=>f.input.feedId='999','FEED_MISMATCH'],[f=>f.state.rows[0].fbProductCategory='123','CATEGORY_ROUTE_UNCONFIRMED'],
  [f=>f.state.rows[0].partnerIntegrationDetails={partnerItemID:'x'},'PARTNER_ROUTE_UNCONFIRMED']]){
  const f=fixture();tweak(f);await assert.rejects(f.client.plan(f.input),{code});assert.equal(f.state.writes.length,0);
 }
});
test('fails closed if official operation ID changes',async()=>{
 const f=fixture({protocolChanged:true});await assert.rejects(f.client.plan(f.input),{code:'EDITOR_PROTOCOL_UNCONFIRMED'});assert.equal(f.state.writes.length,0);
});
test('detects intervening product edits and identity changes before submission',async()=>{
 for(const mutate of [f=>f.state.rows[0].attributes[2].priceValue.amount='12.00',f=>f.state.actor='999']){
  const f=fixture(),p=await f.client.plan(f.input);mutate(f);
  await assert.rejects(f.client.execute(p,{authorizedPlanId:p.id,journalPath:await journal()}));assert.equal(f.state.writes.length,0);
 }
});
test('requires exact plan and existing journal prevents repeat; concurrent execution submits once',async()=>{
 const f=fixture(),p=await f.client.plan(f.input),path=await journal();
 await assert.rejects(f.client.execute({...p,changes:[]},{authorizedPlanId:p.id,journalPath:path}),{code:'PLAN_NOT_AUTHORIZED'});
 const result=await Promise.allSettled([f.client.execute(p,{authorizedPlanId:p.id,journalPath:path}),f.client.execute(p,{authorizedPlanId:p.id,journalPath:path})]);
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.state.writes.length,1);
 const second=fixture(),p2=await second.client.plan(second.input);
 await assert.rejects(second.client.execute(p2,{authorizedPlanId:p2.id,journalPath:path}),{code:'JOURNAL_EXISTS'});assert.equal(second.state.writes.length,0);
});
test('partial success reports per-item result and reconcile never replays writes',async()=>{
 const f=fixture({partial:true}),p=await f.client.plan(f.input),path=await journal();
 const r=await f.client.execute(p,{authorizedPlanId:p.id,journalPath:path});
 assert.equal(r.status,'needs_verification');assert.deepEqual(r.verification.items.map(x=>x.urlMatches),[true,false]);
 const resumed=await f.client.reconcile(path);assert.equal(resumed.replayed,false);assert.equal(f.state.writes.length,1);
});
test('lost responses, failed readback and unintended changes cannot become confirmed success',async()=>{
 for(const [opts,status] of [[{failBeforeResponse:true},'needs_verification'],[{lostResponseAfterCommit:true},'state_verified_response_unconfirmed'],[{readbackFails:true},'needs_verification'],[{sideEffect:true},'needs_verification']]){
  const f=fixture(opts),p=await f.client.plan(f.input);
  const r=await f.client.execute(p,{authorizedPlanId:p.id,journalPath:await journal()});assert.equal(r.status,status);assert.equal(f.state.writes.length,1);
 }
});
test('image client writes source URLs without uploaded image IDs and verifies Graph plus media shape',async()=>{
 const f=fixture({imageMode:true}),p=await f.client.plan(f.input),path=await journal();
 const r=await f.client.execute(p,{authorizedPlanId:p.id,journalPath:path});
 assert.equal(r.status,'verified');assert.equal(f.state.writes.length,1);
 assert.ok(r.verification.items.every(x=>x.imageUrlMatches&&x.mediaShapeMatches&&x.otherFieldsUnchanged));
 for(const item of f.state.writes[0].variables.input.item_data){
  assert.deepEqual(Object.keys(item.base_fields_data).sort(),['id','uploaded_video_ids']);
  assert.deepEqual(item.extended_fields_data,[{field_name:'image_link',field_value:{value_string:'https://new.example/'}},{field_name:'additional_image_link',field_value:{value_list:[]}}]);
 }
 const j=JSON.parse(await readFile(path));assert.equal(j.plan.before[0].imageUrl,'https://images.example/original-1.jpg');
 assert.equal(f.state.rows[0].graph.url,'https://old.example/1');
});
test('image restoration generates a separate reviewed plan from the journal; new image IDs are allowed',async()=>{
 const f=fixture({imageMode:true}),p=await f.client.plan(f.input),path=await journal();
 await f.client.execute(p,{authorizedPlanId:p.id,journalPath:path});
 const restore=await f.client.planRestore(path);assert.equal(restore.restore_from,path);assert.equal(f.state.writes.length,1);
 const r=await f.client.execute(restore,{authorizedPlanId:restore.id,journalPath:await journal()});
 assert.equal(r.status,'verified');assert.equal(f.state.rows[0].graph.image_url,'https://images.example/original-1.jpg');
 assert.notEqual(f.state.rows[0].images[0].id,'800');assert.equal(f.state.writes.length,2);
});
test('image no-op submits nothing, and requests cannot smuggle upload IDs or landing-page fields',async()=>{
 const f=fixture({imageMode:true});f.input.updates.forEach((item,i)=>item.imageUrl=f.state.rows[i].graph.image_url);
 const p=await f.client.plan(f.input),r=await f.client.execute(p,{authorizedPlanId:p.id,journalPath:await journal()});
 assert.equal(r.status,'noop');assert.equal(f.state.writes.length,0);
 for(const patch of [{uploaded_image_id:'999'},{url:'https://other.example/'},{imageUrl:'https://user:pass@other.example/'},{imageUrl:'data:image/png;base64,x'}]){
  const f=fixture({imageMode:true});Object.assign(f.input.updates[0],patch);await assert.rejects(f.client.plan(f.input));
 }
});
test('image client refuses unsupported media and inconsistent Graph identity before writes',async()=>{
 for(const [mutate,code] of [
  [r=>r.images.push({id:'999'}),'MEDIA_ROUTE_UNCONFIRMED'],[r=>r.images=[],'MEDIA_ROUTE_UNCONFIRMED'],
  [r=>r.videos.push({id:'999'}),'MEDIA_ROUTE_UNCONFIRMED'],[r=>delete r.videos,'MEDIA_SCHEMA_CHANGED'],
  [r=>r.graph.retailer_id='different','GRAPH_ITEM_MISMATCH']]){
  const f=fixture({imageMode:true});mutate(f.state.rows[0]);await assert.rejects(f.client.plan(f.input),{code});assert.equal(f.state.writes.length,0);
 }
});
test('intervening image or extra-media changes block submission',async()=>{
 for(const mutate of [r=>r.graph.image_url='https://different.example/',r=>r.images.push({id:'999'})]){
  const f=fixture({imageMode:true}),p=await f.client.plan(f.input);mutate(f.state.rows[0]);
  await assert.rejects(f.client.execute(p,{authorizedPlanId:p.id,journalPath:await journal()}),{code:'ITEMS_CHANGED_SINCE_PLAN'});assert.equal(f.state.writes.length,0);
 }
});
test('image response success cannot hide delayed ingestion, new media or changed price',async()=>{
 for(const opts of [{imageDelayed:true},{extraMediaAfterWrite:true},{graphSideEffect:true},{sideEffect:true}]){
  const f=fixture({imageMode:true,...opts}),p=await f.client.plan(f.input);
  const r=await f.client.execute(p,{authorizedPlanId:p.id,journalPath:await journal()});assert.equal(r.status,'needs_verification');
 }
});
test('partial and lost image responses reconcile without replay',async()=>{
 for(const opts of [{partial:true},{lostResponseAfterCommit:true},{failBeforeResponse:true},{readbackFails:true}]){
  const f=fixture({imageMode:true,...opts}),p=await f.client.plan(f.input),path=await journal();
  const r=await f.client.execute(p,{authorizedPlanId:p.id,journalPath:path});assert.notEqual(r.status,'verified');
  const check=await f.client.reconcile(path);assert.equal(check.replayed,false);assert.equal(f.state.writes.length,1);
 }
});
test('image restore refuses unrelated later edits and journals from another operation or actor',async()=>{
 for(const mutate of [f=>f.state.rows[0].graph.image_url='https://someone-else.example/',f=>f.state.rows[0].graph.price='$12.00']){
  const f=fixture({imageMode:true}),p=await f.client.plan(f.input),path=await journal();await f.client.execute(p,{authorizedPlanId:p.id,journalPath:path});mutate(f);
  await assert.rejects(f.client.planRestore(path),{code:'RESTORE_CONFLICT'});assert.equal(f.state.writes.length,1);
 }
 const u=fixture(),up=await u.client.plan(u.input),path=await journal();await u.client.execute(up,{authorizedPlanId:up.id,journalPath:path});
 const f=fixture({imageMode:true});await assert.rejects(f.client.planRestore(path),{code:'JOURNAL_SCOPE_MISMATCH'});
 const p=await f.client.plan(f.input),ownPath=await journal();await f.client.execute(p,{authorizedPlanId:p.id,journalPath:ownPath});f.state.actor='999';
 await assert.rejects(f.client.planRestore(ownPath),{code:'IDENTITY_CHANGED'});
});
test('rename sends only retailer SKU and title, verifies both reads and restores original name',async()=>{
 const f=fixture({nameMode:true}),p=await f.client.plan(f.input),path=await journal();
 const result=await f.client.execute(p,{authorizedPlanId:p.id,journalPath:path});assert.equal(result.status,'verified');
 assert.deepEqual(f.state.writes[0].variables.input.item_data[0],{base_fields_data:{id:'SKU-1',title:'测试背包 · 新名称'},extended_fields_data:[],item_sub_type:null});
 assert.equal(f.state.rows[0].graph.url,'https://old.example/1');assert.equal(f.state.rows[0].graph.image_url,'https://images.example/original-1.jpg');
 const restore=await f.client.planRestore(path);assert.equal(f.state.writes.length,1);
 assert.equal((await f.client.execute(restore,{authorizedPlanId:restore.id,journalPath:await journal()})).status,'verified');
 assert.equal(f.state.rows[0].graph.name,'Product 1');
});
test('rename validates name length, whitespace and field isolation; unchanged names skip submission',async()=>{
 for(const name of ['', '  ', ' leading', 'trailing ', 'line\nbreak','x'.repeat(201)]){
  const f=fixture({nameMode:true});f.input.updates[0].name=name;await assert.rejects(f.client.plan(f.input));assert.equal(f.state.writes.length,0);
 }
 const f=fixture({nameMode:true});f.input.updates.forEach((x,i)=>x.name=`Product ${i+1}`);
 const p=await f.client.plan(f.input);assert.equal((await f.client.execute(p,{authorizedPlanId:p.id,journalPath:await journal()})).status,'noop');assert.equal(f.state.writes.length,0);
 f.input.updates[0].title='wrong field';await assert.rejects(f.client.plan(f.input),{code:'INVALID_INPUT'});
});
test('rename mismatched data and unintended image or price changes fail verification',async()=>{
 for(const opts of [{nameMismatch:true},{graphSideEffect:true},{sideEffect:true}]){
  const f=fixture({nameMode:true,...opts}),p=await f.client.plan(f.input);
  assert.equal((await f.client.execute(p,{authorizedPlanId:p.id,journalPath:await journal()})).status,'needs_verification');
 }
});
test('rename partial success and lost responses remain read-only during reconciliation',async()=>{
 for(const opts of [{partial:true},{lostResponseAfterCommit:true},{failBeforeResponse:true}]){
  const f=fixture({nameMode:true,...opts}),p=await f.client.plan(f.input),path=await journal();
  assert.notEqual((await f.client.execute(p,{authorizedPlanId:p.id,journalPath:path})).status,'verified');
  await f.client.reconcile(path);assert.equal(f.state.writes.length,1);
 }
});
test('rename refuses concurrent field changes and restore conflicts',async()=>{
 const f=fixture({nameMode:true}),p=await f.client.plan(f.input);f.state.rows[0].graph.image_url='https://changed.example/1.jpg';
 await assert.rejects(f.client.execute(p,{authorizedPlanId:p.id,journalPath:await journal()}),{code:'ITEMS_CHANGED_SINCE_PLAN'});assert.equal(f.state.writes.length,0);
 const g=fixture({nameMode:true}),q=await g.client.plan(g.input),path=await journal();await g.client.execute(q,{authorizedPlanId:q.id,journalPath:path});
 g.state.rows[0].graph.name='Someone else';g.state.rows[0].attributes.find(a=>a.name==='Name').stringValue='Someone else';
 await assert.rejects(g.client.planRestore(path),{code:'RESTORE_CONFLICT'});assert.equal(g.state.writes.length,1);
});
