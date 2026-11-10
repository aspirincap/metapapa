import {OperationError, checkBody} from './common.mjs';

// This function is serialized into the selected Chrome page. It never exports credentials.
export async function pageRequest(input) {
  const allowedPages=['https://www.facebook.com','https://business.facebook.com','https://adsmanager.facebook.com','https://developers.facebook.com'];
  const fail=(code,submitted=false,extra={})=>({ok:false,code,submitted,...extra});
  if(!allowedPages.includes(location.origin))return fail('FACEBOOK_PAGE_REQUIRED');
  if(/^\/(?:checkpoint|recover|login)(?:\/|\.php|$)/.test(new URL(location.href).pathname))return fail('LOGIN_OR_CHALLENGE_REQUIRED');
  const safeRequire=name=>{try{return require(name);}catch{return null;}};
  const user=safeRequire('CurrentUserInitialData');
  const actor=String(user?.USER_ID||'');
  if(!actor||actor==='0')return fail('LOGIN_REQUIRED');
  if(input.actorId && actor!==input.actorId)return fail('IDENTITY_CHANGED');
  const url=new URL(location.href);
  const context={actor_id:actor,origin:location.origin,account_id:url.searchParams.get('act'),business_id:url.searchParams.get('business_id'),catalog_id:url.pathname.match(/\/commerce\/(?:catalogs\/)?(\d+)(?:\/|$)/)?.[1]||null};
  const dtsg=safeRequire('DTSGInitialData')?.token;
  const lsd=safeRequire('LSD')?.token;
  if(input.kind==='session')return {ok:true,data:{...context,web_session_ready:!!(dtsg&&lsd)}};
  const request=input.request;
  if(!request||!['graph','graphql','web'].includes(request.kind))return fail('INVALID_REQUEST');
  const timeoutMs=request.timeoutMs===undefined?20000:request.timeoutMs;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)return fail('INVALID_REQUEST_TIMEOUT');
  if(request.pageOrigin&&request.pageOrigin!==location.origin)return fail('PAGE_ORIGIN_MISMATCH',false,{required_origin:request.pageOrigin});
  const endpoint=new URL(request.path,request.origin||location.origin);
  const allowedRequestOrigins=[...allowedPages,'https://graph.facebook.com','https://adsmanager-graph.facebook.com'];
  if(!allowedRequestOrigins.includes(endpoint.origin)||endpoint.username||endpoint.password||endpoint.hash)return fail('DESTINATION_REJECTED');
  if(!/^\/(?:v\d+\.0(?:\/|$)|api\/graphql\/?$|me\/signals\/?$|ads\/signal\/history\/?$|events_manager\/dataset\/create\/?$|ajax\/settings\/account\/name\.php$|business\/business_objects\/update\/permissions$|ads\/manage\/settings\/remove_agency\/?)$/.test(endpoint.pathname) && request.kind!=='graph')return fail('PATH_REJECTED');
  if(request.kind==='graph'&&!/^\/v\d+\.0(?:\/|$)/.test(endpoint.pathname))return fail('PATH_REJECTED');
  const scrub=(x,depth=0)=>{
    if(depth>20)return '[TRUNCATED]';
    if(typeof x==='string')return x.replace(/\bEAA[A-Za-z0-9_-]{16,}/g,'[REDACTED]').replace(/([?&](?:access_token|fb_dtsg|lsd|jazoest)=)[^&#\s]*/gi,'$1[REDACTED]');
    if(Array.isArray(x))return x.map(v=>scrub(v,depth+1));
    if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).filter(([k])=>!['__proto__','constructor','prototype'].includes(k)).map(([k,v])=>[k,/access.?token|authorization|cookie|password|secret|fb_dtsg|jazoest|^lsd$|file_meta/i.test(k)?'[REDACTED]':scrub(v,depth+1)]));
    return x;
  };
  const params=new URLSearchParams();
  const put=(obj,target=params)=>{for(const [k,v] of Object.entries(obj||{}))if(v!==undefined&&v!==null)target.set(k,typeof v==='object'?JSON.stringify(v):String(v));};
  const headers={};let body;const method=request.method||'GET';
  if(request.kind==='graph'){
    // Only tokens already present in the active page, never disk/browser databases.
    const markup=document.documentElement.innerHTML;
    const candidates=[...new Set(markup.match(/EAA[A-Za-z0-9]{40,}/g)||[])];
    if(candidates.length!==1)return fail(candidates.length?'AMBIGUOUS_PAGE_TOKEN':'PAGE_TOKEN_UNAVAILABLE');
    // Bind the page token to the actual current person before using it for assets.
    try {
      const probe=new URL('/v16.0/me',endpoint.origin);
      probe.searchParams.set('access_token',candidates[0]);probe.searchParams.set('fields','id');
      const identity=await fetch(probe.href,{credentials:'include',redirect:'error',signal:AbortSignal.timeout(12000)});
      const proof=await identity.json();
      if(!identity.ok||String(proof?.id)!==actor)return fail('TOKEN_IDENTITY_MISMATCH');
    } catch {return fail('TOKEN_IDENTITY_UNCONFIRMED');}
    endpoint.searchParams.set('access_token',candidates[0]);
    endpoint.searchParams.set('locale','en_US');
  }else{
    if(endpoint.origin!==location.origin)return fail('SAME_ORIGIN_PAGE_REQUIRED');
    if(!dtsg||!lsd)return fail('WEB_SESSION_UNAVAILABLE');
    const get=safeRequire('getAsyncParams');
    if(typeof get!=='function')return fail('WEB_SESSION_UNAVAILABLE');
    put(get('POST'));put({__user:actor,av:request.actingProfileId||actor,__a:1,fb_dtsg:dtsg,lsd});
    headers['x-fb-lsd']=lsd;
    if(request.kind==='graphql'){
      if(!/^\d+$/.test(request.docId||''))return fail('INVALID_DOC_ID');
      put({fb_api_caller_class:'RelayModern',fb_api_req_friendly_name:request.friendlyName,doc_id:request.docId,variables:request.variables,server_timestamps:true});
      headers['x-fb-friendly-name']=request.friendlyName;
    }
  }
  put(request.query,endpoint.searchParams);put(request.body);
  if(method!=='GET'){headers['content-type']='application/x-www-form-urlencoded;charset=UTF-8';body=params.toString();}
  else for(const [k,v]of params)endpoint.searchParams.set(k,v);
  let response;
  try{response=await fetch(endpoint.href,{method,body,headers,credentials:'include',redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
  catch{return fail('NETWORK_RESULT_UNKNOWN',true);}
  let text;
  try{text=await response.text();}catch{return fail('RESPONSE_RESULT_UNKNOWN',true);}
  if(text.length>12*1024*1024)return fail('RESPONSE_TOO_LARGE',true);
  text=text.replace(/^\s*for\s*\(;;\);\s*/,'');
  let data;
  try{data=JSON.parse(text);}catch{
    try{const frames=text.split('\n').filter(s=>s.trim()).map(s=>JSON.parse(s));data=frames.length===1?frames[0]:{frames};}
    catch{return fail('RESPONSE_NOT_JSON',true,{http_status:response.status});}
  }
  const next=data?.paging?.cursors?.after || (()=>{try{return new URL(data?.paging?.next).searchParams.get('after');}catch{return null;}})();
  const hasMore=!!data?.paging?.next;
  if(data?.paging)delete data.paging.next;
  return {ok:response.ok,http_status:response.status,code:response.ok?undefined:'HTTP_ERROR',submitted:true,data:scrub(data),pagination:{has_more:hasMore,after:next},context};
}

export function createTransport(cdp) {
  if(typeof cdp?.send!=='function')throw new OperationError('CDP_REQUIRED');
  let actorId;
  async function call(payload){
    let out;
    const browserTimeout=Math.min(65000,Math.max(25000,(Number(payload.request?.timeoutMs)||20000)+5000));
    try{out=await cdp.send('Runtime.evaluate',{expression:`(${pageRequest.toString()})(${JSON.stringify({actorId,...payload})})`,awaitPromise:true,returnByValue:true},{timeoutMs:browserTimeout});}
    catch{throw new OperationError('BROWSER_RESULT_UNKNOWN','Chrome request interrupted; reconcile a write before retrying.',{submitted:'unknown'});}
    const result=out?.result?.value;
    if(out?.exceptionDetails||!result)throw new OperationError('BROWSER_RESULT_UNKNOWN','No confirmed browser result.',{submitted:'unknown'});
    if(!result.ok)throw new OperationError(result.code||'REQUEST_FAILED',result.code,{submitted:result.submitted,http_status:result.http_status,required_origin:result.required_origin,error:result.data?.error,errors:result.data?.errors});
    checkBody(result.data);return result;
  }
  return {
    async session(){const result=await call({kind:'session'});actorId=result.data.actor_id;return result.data;},
    async request(request){
      if(request?.timeoutMs!==undefined&&(!Number.isInteger(request.timeoutMs)||request.timeoutMs<1000||request.timeoutMs>60000))throw new OperationError('INVALID_REQUEST_TIMEOUT','Request timeout must be an integer from 1000 to 60000 milliseconds.',{submitted:false});
      if(!actorId)await this.session();return call({kind:'request',request});
    },
    get actorId(){return actorId;}
  };
}
