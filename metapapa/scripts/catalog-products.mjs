import {randomUUID} from 'node:crypto';
import {createTransport} from './lib/transport.mjs';
import {OperationError, numericId, requiredString, digest, stamp, createJournal, readJournal} from './lib/common.mjs';
import {browserContext,assertBrowserContext} from './lib/browser-context.mjs';

// Protocol observed in the official Commerce Manager editor, 2026-11-10.
// A loaded Relay artifact must still match; never guess or silently rotate doc IDs.
const READ = {name:'useCatalogItemsByIdsQuery', id:'28858660767135028', kind:'query'};
const WRITE = {name:'CatalogBulkItemEditorHooksBulkItemUpdateMutation', id:'29601050282817196', kind:'mutation'};
const ORIGIN = 'https://business.facebook.com';
const fail = (code, message=code) => {throw new OperationError(code,message);};
const request = (op,variables) => ({kind:'graphql',origin:ORIGIN,pageOrigin:ORIGIN,path:'/api/graphql/',method:'POST',friendlyName:op.name,docId:op.id,variables});
function url(value) {
  requiredString(value,'url',4096);
  let u;try{u=new URL(value);}catch{fail('INVALID_URL');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||value!==value.trim())fail('INVALID_URL');
  return u.href;
}
function productName(value){
  requiredString(value,'name',200);
  if(value!==value.trim()||/[\u0000-\u001f\u007f]/.test(value))fail('INVALID_NAME','Product name must have no surrounding whitespace or control characters.');
  return value;
}
function shape(node) {
  if(node?.__typename!=='ProductItem'||!Array.isArray(node.attributes)||!Object.hasOwn(node,'fbProductCategory'))fail('ITEM_SCHEMA_CHANGED');
  const attrs=Object.fromEntries(node.attributes.map(a=>[a.name,a]));
  const retailerId=attrs.RetailerID?.stringValue, currentUrl=attrs.ProductURL?.urlValue;
  if(!retailerId||typeof currentUrl!=='string')fail('ITEM_SCHEMA_CHANGED');
  return {productId:String(node.id),retailerId,url:currentUrl,feedId:node.productFeed?.id||null,
    fbProductCategory:node.fbProductCategory,partnerIntegrationDetails:node.partnerIntegrationDetails??null,
    otherAttributes:Object.fromEntries(Object.entries(attrs).filter(([name])=>name!=='ProductURL').sort(([a],[b])=>a.localeCompare(b)))};
}

export function createCatalogProductUrlClient(options={}) {
  return createCatalogProductClient(options,'url');
}
export function createCatalogProductImageClient(options={}) {
  return createCatalogProductClient(options,'imageUrl');
}
export function createCatalogProductNameClient(options={}) {
  return createCatalogProductClient(options,'name');
}
function createCatalogProductClient({cdp,readClient,expectedActorId},field) {
  const context=browserContext(cdp);
  assertBrowserContext(readClient?.browserContext,context);
  const isImage=field==='imageUrl',isName=field==='name';
  const operation=isImage?'catalog.products.images.update':isName?'catalog.products.names.update':'catalog.products.urls.update';
  numericId(expectedActorId,'expectedActorId');
  if(typeof readClient?.paginate!=='function'||typeof readClient?.inspectSession!=='function'||((isImage||isName)&&typeof readClient.query!=='function'))fail('READ_CLIENT_REQUIRED');
  const transport=createTransport(cdp), plans=new Map();
  async function session(catalogId) {
    assertBrowserContext(context,browserContext(cdp));
    const current=await transport.session(), reader=await readClient.inspectSession();
    if(current.actor_id!==expectedActorId||reader.actor_id!==expectedActorId)fail('IDENTITY_CHANGED');
    if(current.origin!==ORIGIN||current.catalog_id!==catalogId)fail('CATALOG_PAGE_MISMATCH');
    return current;
  }
  async function checkProtocol() {
    const result=await cdp.send('Runtime.evaluate',{expression:`(${function(names){
      return names.map(name=>{try{const p=require(name+'.graphql').params;return {name:p.name,id:p.id,kind:p.operationKind};}catch{return null;}});
    }.toString()})(${JSON.stringify([READ.name,WRITE.name])})`,returnByValue:true});
    const observed=result?.result?.value;
    if(!Array.isArray(observed)||observed.length!==2||[READ,WRITE].some((op,i)=>!observed[i]||Object.keys(op).some(k=>op[k]!==observed[i][k])))fail('EDITOR_PROTOCOL_UNCONFIRMED','Open the official editor to load its operation definitions; inspect changed definitions before updating this module.');
  }
  async function read(items) {
    const result=await transport.request(request(READ,{ids:items.map(x=>x.productId),versionFilter:''}));
    const nodes=result.data?.data?.nodes;
    if(!Array.isArray(nodes)||nodes.length!==items.length)fail('ITEM_SCHEMA_CHANGED');
    const rows=nodes.map(shape), ids=new Set(rows.map(x=>x.productId));
    if(ids.size!==items.length||items.some(x=>!ids.has(x.productId)))fail('ITEM_SCHEMA_CHANGED');
    if(isImage||isName)for(let i=0;i<rows.length;i++){
      const node=nodes[i],row=rows[i];
      if(isImage){
        if(!Array.isArray(node.images)||!Array.isArray(node.videos))fail('MEDIA_SCHEMA_CHANGED');
        // Signed preview URIs can rotate; preserve the actual object IDs and source URL.
        row.imageIds=node.images.map(x=>numericId(x?.id,'imageId'));
        row.videoIds=node.videos.map(x=>numericId(x?.id,'videoId'));
      }
      const graph=(await readClient.query('catalogs.products.get',{productId:row.productId})).data;
      if(String(graph?.id)!==row.productId||graph?.retailer_id!==row.retailerId)fail('GRAPH_ITEM_MISMATCH');
      row.graph=graph;
      if(isImage)row.imageUrl=url(graph.image_url);
      if(isName){
        if(typeof graph.name!=='string'||row.otherAttributes.Name?.stringValue!==graph.name)fail('NAME_READBACK_INCONSISTENT');
        row.name=graph.name;
      }
    }
    return items.map(x=>rows.find(r=>r.productId===x.productId));
  }
  function checkItems(rows,updates,feedId) {
    rows.forEach((row,i)=>{
      if(row.retailerId!==updates[i].retailerId)fail('SKU_MISMATCH');
      if(feedId&&row.feedId!==feedId)fail('FEED_MISMATCH');
      // Only the observed uncategorized commerce-item route is adapted here.
      // Category-specific item_sub_type mappings require their own page inspection.
      if(row.fbProductCategory!==''&&row.fbProductCategory!==null)fail('CATEGORY_ROUTE_UNCONFIRMED');
      if(row.partnerIntegrationDetails!==null)fail('PARTNER_ROUTE_UNCONFIRMED');
      if(isImage&&(row.imageIds.length!==1||row.videoIds.length!==0))fail('MEDIA_ROUTE_UNCONFIRMED','This route replaces one main image only; additional images or videos must not be cleared.');
    });
  }
  async function plan({catalogId,feedId,updates}={}) {
    numericId(catalogId,'catalogId');if(feedId!==undefined)numericId(feedId,'feedId');
    if(!Array.isArray(updates)||updates.length<1||updates.length>50)fail('INVALID_INPUT','Use 1–50 products per local task batch; this is not a Meta API quota.');
    const normalized=updates.map(item=>{
      if(!item||Object.keys(item).some(k=>!['productId','retailerId',field].includes(k)))fail('INVALID_INPUT');
      return {productId:numericId(item.productId,'productId'),retailerId:requiredString(item.retailerId,'retailerId'),[field]:isName?productName(item[field]):url(item[field])};
    });
    if(new Set(normalized.map(x=>x.productId)).size!==normalized.length||new Set(normalized.map(x=>x.retailerId)).size!==normalized.length)fail('DUPLICATE_ITEM');
    await session(catalogId);await checkProtocol();
    const membership=await readClient.paginate('catalogs.products.list',{catalogId,limit:100},{maxPages:500});
    if(!membership.complete)fail('INCOMPLETE_CATALOG');
    for(const item of normalized){
      const matches=membership.data.filter(x=>x.retailer_id===item.retailerId);
      if(matches.length!==1||String(matches[0].id)!==item.productId)fail('CATALOG_MEMBERSHIP_MISMATCH');
    }
    const before=await read(normalized);checkItems(before,normalized,feedId);
    const changes=normalized.filter((x,i)=>(isName?before[i][field]:url(before[i][field]))!==x[field]);
    const proposal={id:randomUUID(),operation,actor_id:expectedActorId,browser_context:context,catalogId,feedId:feedId??null,
      updates:normalized,before,changes,skipped:normalized.length-changes.length,created_at:stamp(),
      warning:'Manual overrides may be overwritten by the next feed upload. The source CSV/feed is not modified.',
      verification:isName?'name_client_live_verified_2026-11-10':isImage?'image_client_live_verified_2026-11-10':'official_source_checked; direct_write_and_readback_live_verified_2026-11-10'};
    plans.set(proposal.id,structuredClone(proposal));return proposal;
  }
  function otherFields(row){
    if(isName){
      const {name,graph,otherAttributes,...other}=row;
      const {name:graphName,...graphOther}=graph;
      const {Name,...attributes}=otherAttributes;
      return {...other,graph:graphOther,otherAttributes:attributes};
    }
    if(!isImage)return {...row,url:null};
    const {imageUrl,imageIds,videoIds,graph,...other}=row;
    const {image_url,...graphOther}=graph;
    return {...other,graph:graphOther};
  }
  function checkReadback(row,before,target){
    const identity=row.productId===before.productId&&row.retailerId===before.retailerId&&row.feedId===before.feedId;
    const otherUnchanged=digest(otherFields(row))===digest(otherFields(before));
    const fields=isImage?{
      observedImageUrl:row.imageUrl,expectedImageUrl:target.imageUrl,imageUrlMatches:row.imageUrl===target.imageUrl,
      imageCount:row.imageIds.length,videoCount:row.videoIds.length,mediaShapeMatches:row.imageIds.length===1&&row.videoIds.length===0
    }:isName?{observedName:row.name,expectedName:target.name,nameMatches:row.name===target.name}:{observedUrl:row.url,expectedUrl:target.url,urlMatches:url(row.url)===target.url};
    return {productId:row.productId,retailerId:row.retailerId,...fields,identityMatches:identity,otherFieldsUnchanged:otherUnchanged};
  }
  async function verify(proposal) {
    try {
      const rows=await read(proposal.updates);
      return {status:'read',items:rows.map((row,i)=>checkReadback(row,proposal.before[i],proposal.updates[i]))};
    }catch(e){return {status:'readback_failed',code:e.code||'UNKNOWN'};}
  }
  async function execute(proposal,{authorizedPlanId,journalPath}={}) {
    const stored=plans.get(proposal?.id);
    if(!stored||authorizedPlanId!==proposal.id||!journalPath||JSON.stringify(stored)!==JSON.stringify(proposal))fail('PLAN_NOT_AUTHORIZED');
    plans.delete(proposal.id); // Consume before awaiting, including concurrent execute calls.
    await session(stored.catalogId);await checkProtocol();
    const current=await read(stored.updates);
    if(digest(current)!==digest(stored.before))fail('ITEMS_CHANGED_SINCE_PLAN');
    const journal=await createJournal(journalPath,{operation,plan:stored});
    if(!stored.changes.length){await journal.record('noop');return {status:'noop',submitted:false,journal_path:journalPath};}
    const variables={input:{catalog_id:stored.catalogId,is_showing_canonical_price:false,
      item_data:stored.changes.map(item=>isImage?{
        base_fields_data:{id:item.retailerId,uploaded_video_ids:[]},
        extended_fields_data:[{field_name:'image_link',field_value:{value_string:item.imageUrl}},{field_name:'additional_image_link',field_value:{value_list:[]}}],
        item_sub_type:null
      }:{base_fields_data:{id:item.retailerId,...(isName?{title:item.name}:{link:item.url})},extended_fields_data:[],item_sub_type:null}),
      use_case:'BULK_EDITOR',version:''},shouldReturnUpdatedProductItems:false};
    await journal.record('attempting',{request_fingerprint:digest(variables),count:stored.changes.length});
    let payload,error;
    try{
      const response=await transport.request({...request(WRITE,variables),...(isImage?{timeoutMs:45000}:{})});
      payload=response.data?.data?.bulk_update_items;
      await journal.record('response_received',{payload:payload??null});
    }catch(e){error={code:e.code||'UNKNOWN',details:e.details};await journal.record(e.details?.submitted===false?'not_submitted':'unknown',{error});}
    const verification=await verify(stored);
    const stateMatches=verification.status==='read'&&verification.items.every(x=>(isImage?x.imageUrlMatches&&x.mediaShapeMatches:isName?x.nameMatches:x.urlMatches)&&x.identityMatches&&x.otherFieldsUnchanged);
    const acknowledged=payload?.success===true&&Array.isArray(payload.errors)&&payload.errors.length===0&&payload.updated_items===stored.changes.length&&(payload.created_items===0||payload.created_items===null);
    const status=stateMatches&&acknowledged?'verified':stateMatches?'state_verified_response_unconfirmed':'needs_verification';
    await journal.record(status,{verification});
    return {status,payload,error,verification,replayed:false,journal_path:journalPath};
  }
  async function reconcile(journalPath) {
    const journal=await readJournal(journalPath);
    assertBrowserContext(journal.plan?.browser_context,context);
    if(journal.operation!==operation||journal.plan?.actor_id!==expectedActorId)fail('JOURNAL_SCOPE_MISMATCH');
    await session(journal.plan.catalogId);await checkProtocol();
    return {journalState:journal.state,verification:await verify(journal.plan),replayed:false};
  }
  async function planRestore(journalPath){
    const journal=await readJournal(journalPath),previous=journal.plan;
    assertBrowserContext(previous?.browser_context,context);
    if(journal.operation!==operation||previous?.actor_id!==expectedActorId)fail('JOURNAL_SCOPE_MISMATCH');
    const proposal=await plan({catalogId:previous.catalogId,...(previous.feedId?{feedId:previous.feedId}:{}),
      updates:previous.before.map(x=>({productId:x.productId,retailerId:x.retailerId,[field]:x[field]}))});
    const unchanged=proposal.before.every((row,i)=>{
      const old=previous.before[i],target=previous.updates[i],check=checkReadback(row,old,target);
      return check.identityMatches&&check.otherFieldsUnchanged&&(!isImage||check.mediaShapeMatches)&&(row[field]===target[field]||row[field]===old[field]);
    });
    if(!unchanged){plans.delete(proposal.id);fail('RESTORE_CONFLICT','Current fields differ from both the recorded original and intended result. Reconcile before restoring.');}
    proposal.restore_from=journalPath;plans.set(proposal.id,structuredClone(proposal));return proposal;
  }
  return {plan,execute,reconcile,...(isImage||isName?{planRestore}:{})};
}
