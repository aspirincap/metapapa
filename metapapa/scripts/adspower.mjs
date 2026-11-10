import {OperationError,redact} from './lib/common.mjs';
import {createAdsPowerPage} from './adspower-page.mjs';

const fail=(code,details={})=>{throw new OperationError(code,code,details);};
const loopback=new Set(['127.0.0.1','localhost','[::1]']);
const profileID=value=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(value))fail('INVALID_ADSPOWER_PROFILE_ID');
  return value;
};
export function normalizeLocalApi(value='http://127.0.0.1:50325') {
  let url;try{url=new URL(value);}catch{fail('INVALID_LOCAL_API_URL');}
  if(!loopback.has(url.hostname)&&!['local.adspower.net','local.adspower.com'].includes(url.hostname))fail('LOCAL_API_LOOPBACK_REQUIRED');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')fail('INVALID_LOCAL_API_URL');
  // Official local aliases are resolved to loopback without an external DNS lookup.
  if(url.hostname!=='[::1]')url.hostname='127.0.0.1';
  return url.origin;
}
export function validateBrowserEndpoint(value) {
  let url;try{url=new URL(value);}catch{fail('INVALID_DEBUG_ENDPOINT');}
  if(!['ws:','wss:'].includes(url.protocol)||!loopback.has(url.hostname)||!url.port||url.username||url.password||url.search||url.hash||!/^\/devtools\/browser\/[A-Za-z0-9_-]+$/.test(url.pathname))fail('INVALID_DEBUG_ENDPOINT');
  if(url.hostname==='localhost')url.hostname='127.0.0.1';
  return url.href;
}
function cleanProfile(value) {
  return Object.fromEntries(['user_id','serial_number','name','group_id','group_name','domain_name'].filter(k=>typeof value?.[k]==='string').map(k=>[k,value[k].slice(0,500)]));
}

export function createAdsPowerApi({baseUrl,apiKey,fetchImpl=globalThis.fetch,intervalMs=1100}={}) {
  const base=normalizeLocalApi(baseUrl);
  if(apiKey!==undefined&&(typeof apiKey!=='string'||!apiKey.length||apiKey.length>512||/[\r\n]/.test(apiKey)))fail('INVALID_ADSPOWER_API_KEY');
  if(typeof fetchImpl!=='function'||!Number.isInteger(intervalMs)||intervalMs<0||intervalMs>10000)fail('INVALID_ADSPOWER_OPTIONS');
  let queue=Promise.resolve(),last=0,disposed=false;
  async function request(path,params={},timeoutMs=15000) {
    const call=queue.then(async()=>{
      if(disposed)fail('ADSPOWER_API_DISPOSED');
      const wait=intervalMs-(Date.now()-last);
      if(wait>0)await new Promise(r=>setTimeout(r,wait));
      if(disposed)fail('ADSPOWER_API_DISPOSED');
      last=Date.now();
      const url=new URL(path,base);
      for(const [k,v]of Object.entries(params))if(v!==undefined)url.searchParams.set(k,String(v));
      let response;
      try{response=await fetchImpl(url.href,{headers:apiKey?{Authorization:'Bearer '+apiKey}:{},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
      catch{fail('ADSPOWER_NETWORK_UNCONFIRMED',{path});}
      if([401,403].includes(response.status))fail('ADSPOWER_AUTH_REQUIRED');
      if(response.status===429)fail('ADSPOWER_RATE_LIMITED');
      if(!response.ok)fail('ADSPOWER_HTTP_ERROR',{http_status:response.status});
      let text;try{text=await response.text();}catch{fail('ADSPOWER_RESPONSE_UNCONFIRMED');}
      if(text.length>4*1024*1024)fail('ADSPOWER_RESPONSE_TOO_LARGE');
      let result;try{result=JSON.parse(text);}catch{fail('ADSPOWER_RESPONSE_NOT_JSON');}
      if(result?.code!==0){
        const message=String(result?.msg||'').toLowerCase();
        const reason=/api.?key|authentication|unauthorized|token|验证|密钥/.test(message)?'authentication':/permission|forbidden|权限/.test(message)?'permission':/not exist|not found|不存在/.test(message)?'profile_not_found':/limit|frequen|频繁/.test(message)?'rate_limit':'unspecified';
        fail('ADSPOWER_API_REJECTED',{path,api_code:typeof result?.code==='number'?result.code:null,reason});
      }
      return result.data;
    });
    queue=call.catch(()=>{});return call;
  }
  async function activeRaw(profileId) {
    const result=await request('/api/v1/browser/active',{user_id:profileID(profileId)});
    if(!['Active','Inactive'].includes(result?.status))fail('ADSPOWER_STATUS_UNCONFIRMED');
    return {active:result.status==='Active',...(result.status==='Active'?{endpoint:validateBrowserEndpoint(result.ws?.puppeteer)}:{})};
  }
  const api={
    async status(){await request('/status');return {available:true,base_url:base};},
    async profiles({profileId,groupId,page=1,pageSize=50}={}) {
      if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)fail('INVALID_PROFILE_PAGINATION');
      if(groupId!==undefined)profileID(groupId);
      const data=await request('/api/v1/user/list',{user_id:profileId===undefined?undefined:profileID(profileId),group_id:groupId,page,page_size:pageSize});
      if(!Array.isArray(data?.list))fail('ADSPOWER_PROFILE_LIST_UNCONFIRMED');
      const rows=data.list.map(cleanProfile);
      if(profileId&&rows.some(x=>x.user_id!==profileId))fail('ADSPOWER_PROFILE_MISMATCH');
      return {data:rows,page,page_size:pageSize,may_have_more:rows.length===pageSize,complete:rows.length<pageSize};
    },
    async active(profileId){const state=await activeRaw(profileId);return {profile_id:profileId,active:state.active};},
    async localActive(){const data=await request('/api/v1/browser/local-active');if(!Array.isArray(data?.list))fail('ADSPOWER_STATUS_UNCONFIRMED');return data.list.map(x=>({profile_id:profileID(x.user_id)}));},
    async attach(profileId,{allowStart=false,connect}={}) {
      profileID(profileId);
      let current=await activeRaw(profileId),started=false;
      if(!current.active){
        if(!allowStart)fail('ADSPOWER_PROFILE_NOT_RUNNING');
        try{
          const data=await request('/api/v1/browser/start',{user_id:profileId,headless:0,ip_tab:0,open_tabs:0,clear_cache_after_closing:0},60000);
          current={active:true,endpoint:validateBrowserEndpoint(data?.ws?.puppeteer)};started=true;
        }catch(error){
          if(!['ADSPOWER_NETWORK_UNCONFIRMED','ADSPOWER_RESPONSE_UNCONFIRMED'].includes(error.code))throw error;
          // A timed-out start may already have opened the profile. Query once; never replay start.
          current=await activeRaw(profileId);
          if(!current.active)fail('ADSPOWER_START_RESULT_UNKNOWN');
          started=true;
        }
      }
      if(!connect){
        let puppeteer;try{puppeteer=await import('puppeteer-core');}catch{fail('ADSPOWER_DEPENDENCY_MISSING');}
        connect=puppeteer.connect;
      }
      let browser;
      try{browser=await connect({browserWSEndpoint:current.endpoint,defaultViewport:null,protocolTimeout:65000});}
      catch{fail('ADSPOWER_CDP_CONNECT_FAILED');}
      if(!/Chrome|Chromium|HeadlessChrome/i.test(await browser.version().catch(()=>''))){await browser.disconnect();fail('ADSPOWER_CHROMIUM_REQUIRED');}
      let closed=false;
      const pages=new Map();let sequence=0;
      const ensure=()=>{if(closed||!browser.connected)fail('ADSPOWER_DISCONNECTED');};
      async function wrap(page){
        for(const [key,value]of pages)if(value.raw===page)return value.public;
        const key='tab-'+(++sequence),wrapped=await createAdsPowerPage({page,profileId,tabId:key,ensureConnected:ensure});
        pages.set(key,{raw:page,public:wrapped});return wrapped;
      }
      return {
        provider:'adspower',profileId,started_by_task:started,
        async pages(){ensure();return Promise.all((await browser.pages()).map(wrap));},
        async newPage(url){ensure();const page=await browser.newPage();const result=await wrap(page);if(url)await result.navigate(url);return result;},
        async getPage(tabId){ensure();const value=pages.get(tabId);if(!value||value.raw.isClosed())fail('ADSPOWER_TAB_UNAVAILABLE');return value.public;},
        async disconnect(){if(closed)return;closed=true;await browser.disconnect();pages.clear();return {disconnected:true,browser_closed:false};}
      };
    },
    async stop(profileId,{authorized=false}={}) {if(authorized!==true)fail('ADSPOWER_CLOSE_NOT_AUTHORIZED');await request('/api/v1/browser/stop',{user_id:profileID(profileId)});return {profile_id:profileId,closed:true};},
    dispose(){disposed=true;apiKey=undefined;}
  };
  return api;
}

// Never print raw exceptions from fetch/Puppeteer: they can include headers,
// expressions, debug endpoints or page data.
export function publicAdsPowerError(error) {
  const code=error instanceof OperationError?error.code:'ADSPOWER_OPERATION_UNCONFIRMED';
  return redact({ok:false,code,details:error instanceof OperationError?error.details:undefined});
}
