import {OperationError, numericId, stamp} from './lib/common.mjs';

const ORIGIN = 'https://www.facebook.com';
const RESERVED = new Set(['me','home','login','logout','checkpoint','recover','settings','privacy','help','policies','dialog','ajax','api','photo','photo.php','photos','video','videos','watch','reel','reels','stories','story.php','permalink.php','posts','groups','events','marketplace','gaming','friends','messages','notifications','search','share','sharer','sharer.php','l.php','pages','people','business','ads','adsmanager']);

export function normalizeProfileUrl(value) {
  const fail = () => {throw new OperationError('INVALID_PROFILE_URL','Use a Facebook profile homepage URL, not a post, photo, group, redirect, or settings URL.');};
  if(typeof value!=='string'||value.length>4096||value!==value.trim()||/[\\\u0000-\u0020\u007f]/.test(value))fail();
  let url;try{url=new URL(value);}catch{fail();}
  if(!['https:','http:'].includes(url.protocol)||!['facebook.com','www.facebook.com','m.facebook.com'].includes(url.hostname)||url.username||url.password||url.port)fail();
  if(url.pathname==='/profile.php'){
    const ids=url.searchParams.getAll('id');
    if(ids.length!==1||!/^[1-9]\d{0,29}$/.test(ids[0]))fail();
    return {url:ORIGIN+'/profile.php?id='+ids[0],kind:'numeric',key:ids[0]};
  }
  const match=url.pathname.match(/^\/([A-Za-z0-9.]{1,100})\/?$/);
  if(!match||match[1].startsWith('.')||match[1].endsWith('.')||match[1].includes('..')||match[1].toLowerCase().endsWith('.php')||RESERVED.has(match[1].toLowerCase()))fail();
  const key=match[1].toLowerCase();
  if(/^\d+$/.test(key)&&!/^[1-9]\d{0,29}$/.test(key))fail();
  return {url:ORIGIN+'/'+key,kind:/^\d+$/.test(key)?'numeric':'vanity',key};
}

// Only initialRouteInfo for the requested homepage can identify its profile.
// This intentionally ignores viewerID, photo IDs, story buckets and preloaders.
export function parseProfileRoute(roots,target) {
  const routes=[];let visited=0,limited=false;
  function walk(value,depth){
    if(!value||typeof value!=='object')return;
    if(depth>60||++visited>150000){limited=true;return;}
    if(value.initialRouteInfo?.route)routes.push(value.initialRouteInfo.route);
    for(const child of Object.values(value))if(child&&typeof child==='object')walk(child,depth+1);
  }
  for(const root of roots)walk(root,0);
  if(limited)return {ok:false,code:'PROFILE_RESPONSE_TOO_COMPLEX'};
  const matches=[];
  for(const route of routes){
    if(route.canonicalRouteName!=='comet.fbweb.CometProfileTimelineListViewRoute')continue;
    const root=route.rootView,props=root?.props;
    if(root?.entryPoint?.__dr!=='ProfileCometTimelineListViewRouteRoot.entrypoint'||root?.resource?.__dr!=='ProfileCometTimelineListViewRoot.react')continue;
    if(typeof props?.userID!=='string'||!/^[1-9]\d{0,29}$/.test(props.userID)||typeof props.userVanity!=='string')continue;
    const vanity=props.userVanity.toLowerCase();
    if(!/^[a-z0-9.]{1,100}$/.test(vanity))continue;
    let routeUrl;try{routeUrl=new URL(route.url,'https://www.facebook.com');}catch{continue;}
    if(routeUrl.origin!=='https://www.facebook.com'||routeUrl.username||routeUrl.password)continue;
    const path=routeUrl.pathname.replace(/\/$/,'').toLowerCase();
    const routeId=routeUrl.pathname==='/profile.php'?routeUrl.searchParams.get('id'):path.slice(1);
    const parameter=String(route.params?.vanity||'').toLowerCase();
    const linked=target.kind==='vanity'
      ?path==='/'+target.key&&vanity===target.key&&parameter===target.key
      :props.userID===target.key&&(routeId===target.key||path==='/'+vanity)&&(parameter===target.key||parameter===vanity);
    if(!linked)continue;
    const hosted=route.hostableView?.props;
    if(hosted&&(hosted.userID!==props.userID||String(hosted.userVanity).toLowerCase()!==vanity))return {ok:false,code:'PROFILE_ROUTE_CONFLICT'};
    matches.push({profile_id:props.userID,username:vanity,profile_url:'https://www.facebook.com/'+vanity,id_type:'profile_id'});
  }
  if(!matches.length)return {ok:false,code:'PROFILE_ROUTE_NOT_FOUND'};
  if(new Set(matches.map(x=>x.profile_id+'|'+x.username)).size!==1)return {ok:false,code:'AMBIGUOUS_PROFILE_ROUTE'};
  return {ok:true,data:matches[0]};
}

// Runs wholly in the existing Chrome page; no response HTML or credentials leave it.
export async function pageResolveProfile(input,parseRoute) {
  const start=performance.now();
  const fail=code=>({ok:false,code});
  if(location.origin!=='https://www.facebook.com')return fail('FACEBOOK_WWW_PAGE_REQUIRED');
  const actor=()=>{try{return String(require('CurrentUserInitialData').USER_ID||'');}catch{return '';}};
  const currentActor=actor();
  if(!currentActor||currentActor==='0')return fail('LOGIN_REQUIRED');
  if(input.actorId&&currentActor!==input.actorId)return fail('IDENTITY_CHANGED');
  let target;try{target=new URL(input.target.url);}catch{return fail('INVALID_PROFILE_URL');}
  if(target.origin!==location.origin||target.username||target.password||target.hash)return fail('INVALID_PROFILE_URL');
  if(!Number.isInteger(input.timeoutMs)||input.timeoutMs<1000||input.timeoutMs>30000)return fail('INVALID_TIMEOUT');
  let response;
  try{response=await fetch(target.href,{method:'GET',credentials:'include',redirect:'error',headers:{Accept:'text/html'},signal:AbortSignal.timeout(input.timeoutMs)});}
  catch{return fail('PROFILE_GET_UNAVAILABLE');}
  if(response.status===429)return fail('RATE_LIMITED');
  if(response.status===401||response.status===403)return fail('ACCESS_DENIED');
  if(!response.ok)return fail('PROFILE_HTTP_ERROR');
  if(response.url!==target.href)return fail('UNEXPECTED_RESPONSE_URL');
  if(!response.headers.get('content-type')?.includes('text/html'))return fail('PROFILE_RESPONSE_NOT_HTML');
  let html;try{html=await response.text();}catch{return fail('PROFILE_RESPONSE_UNAVAILABLE');}
  if(html.length>12*1024*1024)return fail('PROFILE_RESPONSE_TOO_LARGE');
  if(actor()!==currentActor||location.origin!=='https://www.facebook.com')return fail('IDENTITY_CHANGED');
  const doc=new DOMParser().parseFromString(html,'text/html');
  if(doc.querySelector('input[name="pass"], form[action*="/login"], form[action*="/checkpoint"]'))return fail('LOGIN_OR_CHALLENGE_REQUIRED');
  const roots=[];
  for(const script of doc.querySelectorAll('script[type="application/json"]')){
    try{roots.push(JSON.parse(script.textContent));}catch{}
  }
  const result=parseRoute(roots,input.target);
  if(!result.ok)return result;
  return {ok:true,actor_id:currentActor,data:{...result.data,request_url:target.href,method:'facebook_web_get_route',request_count:1,elapsed_ms:Math.round(performance.now()-start)}};
}

export function createFacebookIdClient({cdp,expectedActorId}={}) {
  if(typeof cdp?.send!=='function')throw new OperationError('CDP_REQUIRED');
  if(expectedActorId!==undefined)numericId(expectedActorId,'expectedActorId');
  let actorId=expectedActorId;
  return {
    async resolve({url,timeoutMs=15000}={}) {
      const target=normalizeProfileUrl(url);
      if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw new OperationError('INVALID_TIMEOUT');
      let response;
      try{response=await cdp.send('Runtime.evaluate',{
        expression:`(${pageResolveProfile.toString()})(${JSON.stringify({target,actorId,timeoutMs})},${parseProfileRoute.toString()})`,
        awaitPromise:true,returnByValue:true
      },{timeoutMs:timeoutMs+5000});}
      catch{throw new OperationError('BROWSER_READ_UNAVAILABLE','Read-only profile lookup interrupted; inspect the page before retrying.');}
      const result=response?.result?.value;
      if(response?.exceptionDetails||!result)throw new OperationError('BROWSER_READ_UNAVAILABLE');
      if(!result.ok)throw new OperationError(result.code||'PROFILE_LOOKUP_FAILED','Direct lookup was not verified. Use the official page to resolve the target; do not guess an ID.');
      if(actorId&&result.actor_id!==actorId)throw new OperationError('IDENTITY_CHANGED');
      numericId(result.actor_id,'actorId');numericId(result.data?.profile_id,'profileId');
      actorId=result.actor_id;
      return {operation:'facebook.profileId.resolve',status:'resolved',fetched_at:stamp(),...result.data};
    }
  };
}
