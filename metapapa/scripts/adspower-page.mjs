import {access,mkdir} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {OperationError,redact} from './lib/common.mjs';
const fail=code=>{throw new OperationError(code);};
const origins=new Set(['https://www.facebook.com','https://business.facebook.com','https://adsmanager.facebook.com','https://developers.facebook.com']);
export function validateMetaNavigation(value) {
  let url;try{url=new URL(value);}catch{fail('META_NAVIGATION_REJECTED');}
  if(!origins.has(url.origin)||url.username||url.password||/\/(?:logout(?:\.php)?|login\/device-based\/validate-password)(?:\/|$)/i.test(url.pathname))fail('META_NAVIGATION_REJECTED');
  if(/\/(?:api|ajax)(?:\/|$)|\/(?:delete|remove|update|submit|remove_agency)(?:\.php)?(?:\/|$)/i.test(url.pathname))fail('META_NAVIGATION_REJECTED');
  if([...url.searchParams.keys()].some(k=>/token|password|secret|cookie|^method$/i.test(k)))fail('META_NAVIGATION_REJECTED');
  return url.href;
}
export function isCatalogPage(value) {
  try{const u=new URL(value);return u.origin==='https://business.facebook.com'&&/^\/commerce\/(?:catalogs\/)?[1-9]\d*(?:\/|$)/.test(u.pathname);}catch{return false;}
}
export function inspectFacebookLogin() {
  const url=new URL(location.href);
  if(/^\/(?:checkpoint|recover)(?:\/|$)/.test(url.pathname))return {status:'challenge_required',url:url.href,ready:false};
  if(/^\/login(?:\/|\.php|$)/.test(url.pathname))return {status:'login_required',url:url.href,ready:false};
  let user;try{user=require('CurrentUserInitialData');}catch{}
  const actor=String(user?.USER_ID||'');
  if(!/^[1-9]\d+$/.test(actor))return {status:'login_or_identity_required',url:url.href,ready:false};
  return {status:'session_detected',ready:true,actor_id:actor,
    visible_name:typeof user?.NAME==='string'?user.NAME.slice(0,200):null,
    url:url.href,personal_identity_requires_ui_check:true};
}
export async function createAdsPowerPage({page,profileId,tabId,ensureConnected=()=>{}}) {
  const session=await page.createCDPSession();
  let interrupted=false;
  const ensure=()=>{ensureConnected();if(page.isClosed())fail('ADSPOWER_TAB_UNAVAILABLE');if(interrupted)fail('ADSPOWER_PAGE_RESULT_UNKNOWN');};
  async function bounded(task,timeoutMs=30000) {
    if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>65000)fail('INVALID_ADSPOWER_TIMEOUT');
    let timer;
    try{return await Promise.race([task(),new Promise((_,reject)=>{timer=setTimeout(()=>{interrupted=true;reject(new OperationError('ADSPOWER_PAGE_RESULT_UNKNOWN'));},timeoutMs);})]);}
    catch(error){if(error instanceof OperationError)throw error;fail('ADSPOWER_PAGE_OPERATION_UNCONFIRMED');}
    finally{clearTimeout(timer);}
  }
  const cdp=Object.freeze({context:Object.freeze({provider:'adspower',profile_id:profileId,tab_id:tabId}),
    async send(method,params,options={}){ensure();if(method!=='Runtime.evaluate')fail('UNSUPPORTED_ADSPOWER_CDP_METHOD');return bounded(()=>session.send(method,params),options.timeoutMs??30000);}
  });
  async function catalogWrite(authorization) {
    ensure();if(authorization?.kind!=='catalog_write'||!authorization.expectedActorId||!authorization.catalogId)fail('UI_WRITE_NOT_AUTHORIZED');
    if(!isCatalogPage(page.url())||new URL(page.url()).pathname.match(/\/commerce\/(?:catalogs\/)?(\d+)/)?.[1]!==authorization.catalogId)fail('UI_AD_ACCOUNT_WRITES_FORBIDDEN');
    const actor=await bounded(()=>page.evaluate(()=>{try{return String(require('CurrentUserInitialData').USER_ID||'');}catch{return '';}}));
    if(actor!==authorization.expectedActorId)fail('IDENTITY_CHANGED');
  }
  async function catalogCreate(authorization) {
    ensure();const current=new URL(page.url());
    if(authorization?.kind!=='catalog_create'||!authorization.expectedActorId||!/^\d+$/.test(authorization.businessId||''))fail('UI_WRITE_NOT_AUTHORIZED');
    if(current.origin!=='https://business.facebook.com'||!['/commerce/','/products/catalogs/new/'].includes(current.pathname)||current.searchParams.get('business_id')!==authorization.businessId)fail('CATALOG_CREATE_CONTEXT_REQUIRED');
    const login=await bounded(()=>page.evaluate(inspectFacebookLogin));
    if(!login.ready||login.actor_id!==authorization.expectedActorId)fail('IDENTITY_CHANGED');
  }
  async function handle(selector) {
    if(typeof selector!=='string'||!selector.length||selector.length>1000)fail('INVALID_UI_SELECTOR');
    if(typeof page.bringToFront==='function')await bounded(()=>page.bringToFront());
    const result=await bounded(()=>page.evaluateHandle(selector=>{
      let elements;
      if(selector.startsWith('::-p-text(')&&selector.endsWith(')')){
        const text=selector.slice(10,-1);
        elements=Array.from(document.querySelectorAll('*')).filter(e=>e.textContent?.includes(text)&&!Array.from(e.children).some(c=>c.textContent?.includes(text))&&e.getBoundingClientRect().width&&e.getBoundingClientRect().height);
      }else if(selector.startsWith('::-p-xpath(')&&selector.endsWith(')')){
        const found=document.evaluate(selector.slice(11,-1),document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);elements=Array.from({length:found.snapshotLength},(_,i)=>found.snapshotItem(i));
      }else elements=Array.from(document.querySelectorAll(selector));
      return {count:elements.length,element:elements.length===1?elements[0]:null};
    },selector));
    try{
      if(await bounded(()=>result.evaluate(x=>x.count))!==1)fail('UI_TARGET_NOT_UNIQUE');
      const element=await bounded(()=>result.getProperty('element'));return element.asElement();
    }finally{await result.dispose();}
  }
  async function clickElement(element){
    await bounded(()=>element.evaluate(e=>{if(e.disabled||e.getAttribute('aria-disabled')==='true'||!e.getBoundingClientRect().width||!e.getBoundingClientRect().height)throw Error('UI target unavailable');e.click();}));
  }

  return {
    tabId,profileId,cdp,
    async info(){ensure();return {tab_id:tabId,profile_id:profileId,url:redact(page.url()),title:redact((await page.title()).slice(0,500))};},
    async loginState(){ensure();return redact(await bounded(()=>page.evaluate(inspectFacebookLogin)));},
    async navigate(url){ensure();const target=validateMetaNavigation(url);await bounded(()=>page.goto(target,{waitUntil:'domcontentloaded',timeout:30000}),35000);return {tab_id:tabId,url:redact(page.url())};},
    async snapshot(){ensure();const result=await bounded(()=>page.evaluate(()=>{
      // Only rendered text and control labels; no scripts, HTML, input values or hidden data.
      const visible=e=>!!(e.getBoundingClientRect().width&&e.getBoundingClientRect().height)&&getComputedStyle(e).visibility!=='hidden';
      const selector=e=>{const parts=[];for(let n=e;n&&n.nodeType===1;n=n.parentElement){if(n.id&&document.querySelectorAll('#'+CSS.escape(n.id)).length===1){parts.unshift('#'+CSS.escape(n.id));break;}const tag=n.tagName.toLowerCase();const index=n.parentElement?Array.from(n.parentElement.children).filter(s=>s.tagName===n.tagName).indexOf(n)+1:1;parts.unshift(tag+':nth-of-type('+index+')');}return parts.join(' > ');};
      const controls=Array.from(document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="combobox"],[role="checkbox"],[role="tab"],[role="option"],[role="menuitem"]')).filter(visible).slice(0,200).map(e=>({tag:e.tagName.toLowerCase(),role:e.getAttribute('role'),type:e.getAttribute('type'),...(e.type==='checkbox'||e.getAttribute('role')==='checkbox'?{checked:e.checked??e.getAttribute('aria-checked')}:{}),label:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||'').slice(0,200),selector:selector(e),...(e.tagName==='A'?{href:e.href}:{})}));
      return {title:document.title,url:location.href,text:document.body?.innerText?.slice(0,18000)||'',controls};
    }));return redact(result);},
    async screenshot(path){ensure();if(!isAbsolute(path))fail('ABSOLUTE_OUTPUT_PATH_REQUIRED');try{await access(path);fail('OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}await mkdir(dirname(path),{recursive:true});await bounded(()=>page.screenshot({path,fullPage:false}));return {path};},
    async clickLink(selector){ensure();const element=await handle(selector);try{const href=await element.evaluate(e=>e.tagName==='A'?e.href:null);if(!href)fail('NAVIGATION_LINK_REQUIRED');return await this.navigate(href);}finally{await element.dispose();}},
    async click(selector,authorization){await catalogWrite(authorization);const element=await handle(selector);try{await clickElement(element);return {submitted:true,verification:'readback_required'};}finally{await element.dispose();}},
    async creatorClick(selector,authorization){await catalogCreate(authorization);const element=await handle(selector);try{await clickElement(element);return {submitted:true,verification:'readback_required'};}finally{await element.dispose();}},
    async creatorFill(selector,value,authorization){await catalogCreate(authorization);if(typeof value!=='string'||value.length>200)fail('INVALID_UI_VALUE');const element=await handle(selector);try{const permitted=await element.evaluate(e=>e.tagName==='INPUT'&&e.type==='text'&&!/password|token|secret|otp|cookie/i.test(e.name||''));if(!permitted)fail('UI_FIELD_REJECTED');await bounded(()=>element.evaluate((e,value)=>{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value));if(!await bounded(()=>element.evaluate((e,expected)=>e.value===expected,value)))fail('UI_VALUE_MISMATCH');return {filled:true,saved:false,value_verified:true};}finally{await element.dispose();}},
    async fill(selector,value,authorization){await catalogWrite(authorization);if(typeof value!=='string'||value.length>20000)fail('INVALID_UI_VALUE');const element=await handle(selector);try{const permitted=await element.evaluate(e=>['INPUT','TEXTAREA'].includes(e.tagName)&&!['password','hidden','file','submit','button','checkbox','radio'].includes(e.type)&&!/password|token|secret|otp|cookie/i.test(e.name||''));if(!permitted)fail('UI_FIELD_REJECTED');await bounded(()=>element.evaluate((e,value)=>{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value));if(!await bounded(()=>element.evaluate((e,expected)=>e.value===expected,value)))fail('UI_VALUE_MISMATCH');return {filled:true,saved:false,value_verified:true};}finally{await element.dispose();}},
    async upload(selector,path,authorization){await catalogWrite(authorization);if(!isAbsolute(path))fail('ABSOLUTE_INPUT_PATH_REQUIRED');await access(path);const element=await handle(selector);try{if(!(await element.evaluate(e=>e.tagName==='INPUT'&&e.type==='file')))fail('FILE_INPUT_REQUIRED');await bounded(()=>element.uploadFile(path));return {file_selected:true,verification:'readback_required'};}finally{await element.dispose();}}
  };
}
