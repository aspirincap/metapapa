import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createAdsPowerApi,normalizeLocalApi,validateBrowserEndpoint,publicAdsPowerError} from '../../metapapa/scripts/adspower.mjs';
import {createAdsPowerPage,validateMetaNavigation,inspectFacebookLogin} from '../../metapapa/scripts/adspower-page.mjs';
import {pageRequest} from '../../metapapa/scripts/lib/transport.mjs';
import {createAdsPowerRunner} from '../../metapapa/scripts/adspower-runner.mjs';
import {createMetaClient,capabilities} from '../../metapapa/scripts/client.mjs';
import {assertWriteAllowed} from '../../metapapa/scripts/lib/write-policy.mjs';
import {browserContext,assertBrowserContext} from '../../metapapa/scripts/lib/browser-context.mjs';
import {redact} from '../../metapapa/scripts/lib/common.mjs';

const ws='ws://127.0.0.1:5555/devtools/browser/mock-id';
const rejected=code=>e=>e.code===code;
function response(data,extra={}){return {status:200,ok:true,text:async()=>JSON.stringify({code:0,data}),...extra};}
function apiFixture(handler){const calls=[];return {calls,api:createAdsPowerApi({apiKey:'unit-test-key',intervalMs:0,fetchImpl:async(url,options)=>{calls.push({url:new URL(url),options});return handler(new URL(url),options);}})};}
function browserFixture(){let disconnects=0,closes=0;const pages=[];const browser={connected:true,async version(){return 'Chrome/140.0';},async pages(){return pages;},async newPage(){const p=pageFixture();pages.push(p);return p;},async disconnect(){disconnects++;browser.connected=false;},async close(){closes++;}};return {browser,counts:()=>({disconnects,closes})};}
function pageFixture(){const requests=[];let href='https://www.facebook.com/',closed=false;const page={
  requests,isClosed:()=>closed,url:()=>href,async title(){return 'Example';},
  async createCDPSession(){return {send:async(method,params)=>{requests.push({method,params});return {result:{value:{ok:true,data:{actor_id:'111',web_session_ready:true,origin:'https://www.facebook.com'}}}};}};},
  async goto(url){href=url;},async evaluate(){return '111';},async screenshot(){},async $$(){return [];},
  async evaluateHandle(){const elements=await page.$$();return {async evaluate(fn){return fn({count:elements.length});},async getProperty(){return {asElement:()=>elements[0]};},async dispose(){}};}
};return page;}

test('AdsPower permits only loopback API endpoints and rewrites official aliases',()=>{
  assert.equal(normalizeLocalApi('http://local.adspower.com:50325/'),'http://127.0.0.1:50325');
  for(const value of ['https://outside.test','http://u:p@127.0.0.1:1','http://127.0.0.1:1/api','http://127.0.0.1:1/?key=x'])assert.throws(()=>normalizeLocalApi(value));
  assert.equal(validateBrowserEndpoint(ws),ws);
  for(const value of ['ws://outside.test:5/devtools/browser/x','ws://127.0.0.1:5/devtools/page/x',ws+'?token=x'])assert.throws(()=>validateBrowserEndpoint(value),rejected('INVALID_DEBUG_ENDPOINT'));
});
test('profile listing filters sensitive fields and reports pagination',async()=>{
  const {api,calls}=apiFixture(()=>response({list:[{user_id:'test',name:'A',password:'do-not-return',username:'hidden',proxy_password:'hidden',ws:{puppeteer:ws}}]}));
  const result=await api.profiles({profileId:'test',pageSize:1});
  assert.deepEqual(result.data,[{user_id:'test',name:'A'}]);assert.equal(result.complete,false);
  assert.equal(calls[0].options.headers.Authorization,'Bearer unit-test-key');assert.equal(calls[0].options.redirect,'error');
  assert(!JSON.stringify(result).includes('hidden'));assert(!JSON.stringify(result).includes(ws));
});
test('profile mismatch and invalid input cause no browser launch',async()=>{
  const {api,calls}=apiFixture(()=>response({list:[{user_id:'other'}]}));
  await assert.rejects(api.profiles({profileId:'test'}),rejected('ADSPOWER_PROFILE_MISMATCH'));
  await assert.rejects(api.attach('bad?token=x'),rejected('INVALID_ADSPOWER_PROFILE_ID'));assert.equal(calls.length,1);
});
test('API errors and secrets never leave public errors',async()=>{
  const {api}=apiFixture(()=>response(null,{text:async()=>JSON.stringify({code:-1,msg:'API key unit-test-key invalid'})}));
  let error;try{await api.status();}catch(e){error=e;}
  assert.equal(error.details.reason,'authentication');assert.equal(error.details.path,'/status');
  assert(!JSON.stringify(publicAdsPowerError(error)).includes('unit-test-key'));
  assert.equal(redact({apiKey:'secret'}).apiKey,'[REDACTED]');
  assert.deepEqual(publicAdsPowerError(new Error('Bearer raw-secret')),{ok:false,code:'ADSPOWER_OPERATION_UNCONFIRMED',details:undefined});
});
test('HTTP 429 is not automatically retried',async()=>{
  const {api,calls}=apiFixture(()=>response(null,{status:429,ok:false}));await assert.rejects(api.status(),rejected('ADSPOWER_RATE_LIMITED'));assert.equal(calls.length,1);
});
test('active profile is reused and detach never closes browser',async()=>{
  const {api,calls}=apiFixture(()=>response({status:'Active',ws:{puppeteer:ws}})),fake=browserFixture();
  const connection=await api.attach('test',{allowStart:true,connect:async options=>{assert.equal(options.browserWSEndpoint,ws);return fake.browser;}});
  assert.equal(connection.started_by_task,false);assert.equal(calls.length,1);
  await connection.disconnect();await connection.disconnect();assert.deepEqual(fake.counts(),{disconnects:1,closes:0});
});
test('inactive profile does not start without task authorization',async()=>{
  const {api,calls}=apiFixture(()=>response({status:'Inactive'}));await assert.rejects(api.attach('test'),rejected('ADSPOWER_PROFILE_NOT_RUNNING'));assert.equal(calls.length,1);
});
test('start uses visible window and preserves cache/history',async()=>{
  const {api,calls}=apiFixture(url=>response(url.pathname.endsWith('/active')?{status:'Inactive'}:{ws:{puppeteer:ws}})),fake=browserFixture();
  const connection=await api.attach('test',{allowStart:true,connect:async()=>fake.browser});
  const start=calls[1].url;assert.equal(start.pathname,'/api/v1/browser/start');assert.equal(start.searchParams.get('headless'),'0');assert.equal(start.searchParams.get('open_tabs'),'0');assert.equal(start.searchParams.get('clear_cache_after_closing'),'0');assert.equal(connection.started_by_task,true);await connection.disconnect();
});
test('uncertain start checks status once and does not replay',async()=>{
  let active=0;const {api,calls}=apiFixture(url=>{if(url.pathname.endsWith('/start'))throw Error('timeout');return response(++active===1?{status:'Inactive'}:{status:'Active',ws:{puppeteer:ws}});});
  const connection=await api.attach('test',{allowStart:true,connect:async()=>browserFixture().browser});
  assert.equal(calls.filter(x=>x.url.pathname.endsWith('/start')).length,1);assert.equal(active,2);await connection.disconnect();
});
test('still inactive after uncertain start remains unknown',async()=>{
  const {api,calls}=apiFixture(url=>{if(url.pathname.endsWith('/start'))throw Error('timeout');return response({status:'Inactive'});});
  await assert.rejects(api.attach('test',{allowStart:true}),rejected('ADSPOWER_START_RESULT_UNKNOWN'));assert.equal(calls.length,3);
});
test('stopping needs explicit authorization and disposal forgets API access',async()=>{
  const {api,calls}=apiFixture(()=>response({}));await assert.rejects(api.stop('test'),rejected('ADSPOWER_CLOSE_NOT_AUTHORIZED'));assert.equal(calls.length,0);
  await api.stop('test',{authorized:true});api.dispose();await assert.rejects(api.status(),rejected('ADSPOWER_API_DISPOSED'));assert.equal(calls.length,1);
});
test('page CDP preserves protocol shape and immutable environment identity',async()=>{
  const page=pageFixture(),tab=await createAdsPowerPage({page,profileId:'test',tabId:'tab-1'});
  const value=await tab.cdp.send('Runtime.evaluate',{expression:'1'}, {timeoutMs:2000});
  assert.equal(value.result.value.data.actor_id,'111');assert.equal(tab.cdp.context.profile_id,'test');assert(Object.isFrozen(tab.cdp.context));
  await assert.rejects(tab.cdp.send('Network.getAllCookies',{}),rejected('UNSUPPORTED_ADSPOWER_CDP_METHOD'));
});
test('CDP timeout poisons page until reconnection without replay',async()=>{
  const page=pageFixture();let count=0;page.createCDPSession=async()=>({send:()=>{count++;return new Promise(()=>{});}});
  const tab=await createAdsPowerPage({page,profileId:'test',tabId:'tab-1'});
  await assert.rejects(tab.cdp.send('Runtime.evaluate',{}, {timeoutMs:1000}),rejected('ADSPOWER_PAGE_RESULT_UNKNOWN'));
  await assert.rejects(tab.cdp.send('Runtime.evaluate',{}),rejected('ADSPOWER_PAGE_RESULT_UNKNOWN'));assert.equal(count,1);
});
test('navigation rejects external and action endpoints',()=>{
  assert.equal(validateMetaNavigation('https://business.facebook.com/commerce/catalogs/123/'),'https://business.facebook.com/commerce/catalogs/123/');
  for(const url of ['https://outside.test','javascript:alert(1)','https://www.facebook.com/logout.php','https://business.facebook.com/api/graphql/','https://business.facebook.com/ads/manage/settings/remove_agency','https://www.facebook.com/?access_token=x'])assert.throws(()=>validateMetaNavigation(url),rejected('META_NAVIGATION_REJECTED'));
});
test('UI writes cannot target advertising pages even with a catalog label',async()=>{
  const page=pageFixture();page.url=()=> 'https://adsmanager.facebook.com/manage/';const tab=await createAdsPowerPage({page,profileId:'test',tabId:'tab-1'});
  await assert.rejects(tab.click('button',{kind:'catalog_write',expectedActorId:'111',catalogId:'123'}),rejected('UI_AD_ACCOUNT_WRITES_FORBIDDEN'));
  await assert.rejects(tab.fill('input','text',{}),rejected('UI_WRITE_NOT_AUTHORIZED'));
});
test('catalog UI requires exact catalog and current actor',async()=>{
  const page=pageFixture();page.url=()=> 'https://business.facebook.com/commerce/catalogs/123/';const tab=await createAdsPowerPage({page,profileId:'test',tabId:'tab-1'});
  await assert.rejects(tab.click('button',{kind:'catalog_write',expectedActorId:'999',catalogId:'123'}),rejected('IDENTITY_CHANGED'));
  await assert.rejects(tab.click('button',{kind:'catalog_write',expectedActorId:'111',catalogId:'456'}),rejected('UI_AD_ACCOUNT_WRITES_FORBIDDEN'));
});
test('same actor in different AdsPower profiles cannot reuse a journal',async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'metapapa-profile-')),'journal.json');
  await writeFile(file,JSON.stringify({actor_id:'111',browser_context:{provider:'adspower',profile_id:'first'},operation:'accounts.rename',params:{accountId:'222',name:'name'}}));
  const page=pageFixture(),tab=await createAdsPowerPage({page,profileId:'second',tabId:'tab-1'}),client=createMetaClient({cdp:tab.cdp});
  await assert.rejects(client.reconcile(file),rejected('BROWSER_PROFILE_MISMATCH'));
  assert.deepEqual(browserContext(tab.cdp),{provider:'adspower',profile_id:'second'});
  assert.throws(()=>assertBrowserContext(null,browserContext(tab.cdp)),rejected('BROWSER_PROFILE_MISMATCH'));
});
test('ad account, ad delivery and untyped permission writes are blocked before CDP',async()=>{
  let calls=0;const client=createMetaClient({cdp:{send(){calls++;throw Error('must not connect');}}});
  const names=['accounts.rename','accounts.spendCap.set','accounts.users.remove','accounts.currency.set','ads.status.set','businesses.accounts.create','businesses.accounts.attach','pixels.accounts.share','datasets.accounts.connect','assets.partners.remove','datasets.users.assign','businesses.members.remove'];
  for(const name of names)await assert.rejects(client.plan(name,{}),rejected('AD_ACCOUNT_WRITES_FORBIDDEN'));
  assert.equal(calls,0);assert.equal(client.writePolicy,'no_ad_account_writes');
});
test('read-only policy rejects every registered mutation',()=>{
  for(const op of capabilities().filter(x=>x.write))assert.throws(()=>assertWriteAllowed(op,'read_only'),rejected('READ_ONLY_MODE'));
  assert.doesNotThrow(()=>assertWriteAllowed({name:'accounts.list',write:false},'read_only'));
  assert.doesNotThrow(()=>assertWriteAllowed({name:'comments.hide',write:true},'no_ad_account_writes'));
  assert.throws(()=>assertWriteAllowed({name:'new.unclassified.write',write:true}),rejected('AD_ACCOUNT_WRITES_FORBIDDEN'));
});
test('runner consumes key, defaults to read-only and disconnects without closing profile',async()=>{
  let disposed=false,detached=false;const fakePage={async info(){return {tab_id:'tab-1'};}};
  const runner=createAdsPowerRunner({apiFactory:({apiKey})=>{assert.equal(apiKey,'unit-test-key');return {async status(){return {available:true};},async profiles(){return {data:[{user_id:'test'}]};},async attach(){return {started_by_task:false,async pages(){return [fakePage];},async disconnect(){detached=true;}};},dispose(){disposed=true;}};}});
  const config={command:'connect',apiKey:'unit-test-key',profileId:'test'};const result=await runner.dispatch(config);
  assert.equal(config.apiKey,undefined);assert.equal(result.mode,'read_only');assert.equal(result.ad_account_writes,'forbidden');
  await assert.rejects(runner.dispatch({command:'product_execute'}),rejected('READ_ONLY_MODE'));
  await assert.rejects(runner.dispatch({command:'ui_click'}),rejected('READ_ONLY_MODE'));
  await assert.rejects(runner.dispatch({command:'evaluate'}),rejected('RUNNER_COMMAND_UNAVAILABLE'));
  await assert.rejects(runner.dispatch({command:'accounts.rename'}),rejected('RUNNER_COMMAND_UNAVAILABLE'));
  await runner.close();assert(disposed&&detached);
});
test('checkpoint and login detection do not probe account modules',()=>{
  for(const [path,status]of [['/checkpoint/123/','challenge_required'],['/login.php','login_required']]){
    const context=vm.createContext({URL,location:{href:'https://www.facebook.com'+path},require(){assert.fail('No account probe on challenge page');}});
    assert.equal(vm.runInContext(`(${inspectFacebookLogin.toString()})()`,context).status,status);
  }
  const context=vm.createContext({URL,location:{href:'https://www.facebook.com/'},require:()=>({USER_ID:'111',NAME:'Example',token:'hidden'})});
  const result=vm.runInContext(`(${inspectFacebookLogin.toString()})()`,context);assert.equal(result.actor_id,'111');assert.equal(result.visible_name,'Example');assert(!JSON.stringify(result).includes('hidden'));
});
test('core Chrome/AdsPower transport refuses checkpoint before fetching',async()=>{
  const context=vm.createContext({URL,location:{origin:'https://www.facebook.com',href:'https://www.facebook.com/checkpoint/123'},fetch(){assert.fail('No fetch');},require(){assert.fail('No credentials');}});
  const result=await vm.runInContext(`(${pageRequest.toString()})({kind:'session'})`,context);assert.equal(result.code,'LOGIN_OR_CHALLENGE_REQUIRED');
});
test('runner blocks business reads on challenge pages',async()=>{
  let cdpCalls=0;const fakePage={async info(){return {tab_id:'tab-1'};},async loginState(){return {status:'challenge_required',ready:false};},cdp:{send(){cdpCalls++;}}};
  const runner=createAdsPowerRunner({apiFactory:()=>({async status(){return {};},async profiles(){return {data:[{user_id:'test'}]};},async attach(){return {async pages(){return [fakePage];},async getPage(){return fakePage;},async disconnect(){}};},dispose(){}})});
  await runner.dispatch({command:'connect',profileId:'test'});
  await assert.rejects(runner.dispatch({command:'read',tabId:'tab-1',operation:'accounts.list'}),rejected('LOGIN_OR_CHALLENGE_REQUIRED'));assert.equal(cdpCalls,0);await runner.close();
});
test('catalog UI supports selected file and rejects password fields',async()=>{
  const page=pageFixture();page.url=()=> 'https://business.facebook.com/commerce/catalogs/123/';let uploaded,disposed=0;
  const input={tagName:'INPUT',type:'file',name:'products'};
  page.$$=async()=>[{async evaluate(fn){return fn(input);},async uploadFile(path){uploaded=path;},async dispose(){disposed++;}}];
  const tab=await createAdsPowerPage({page,profileId:'test',tabId:'tab-1'}),auth={kind:'catalog_write',expectedActorId:'111',catalogId:'123'};
  const path=join(await mkdtemp(join(tmpdir(),'metapapa-ui-')),'example.csv');await writeFile(path,'id,title\n123,Example\n');
  assert.equal((await tab.upload('input',path,auth)).file_selected,true);assert.equal(uploaded,path);
  input.type='password';await assert.rejects(tab.fill('input','secret',auth),rejected('UI_FIELD_REJECTED'));assert.equal(disposed,2);
});
test('UI navigation only follows a unique link and screenshot never overwrites',async()=>{
  const page=pageFixture();page.$$=async()=>[{async evaluate(fn){return fn({tagName:'A',href:'https://www.facebook.com/example'});},async dispose(){}}];
  const tab=await createAdsPowerPage({page,profileId:'test',tabId:'tab-1'});await tab.clickLink('a');assert.equal(page.url(),'https://www.facebook.com/example');
  const path=join(await mkdtemp(join(tmpdir(),'metapapa-shot-')),'existing.png');await writeFile(path,'preserve');await assert.rejects(tab.screenshot(path),rejected('OUTPUT_EXISTS'));
  page.$$=async()=>[];await assert.rejects(tab.clickLink('missing'),rejected('UI_TARGET_NOT_UNIQUE'));
});
test('catalog creator UI is bound to the selected BM and rejects advertising pages',async()=>{
  const page=pageFixture();let clicks=0;
  page.url=()=> 'https://business.facebook.com/commerce/?business_id=123';
  page.evaluate=async()=>({ready:true,actor_id:'111'});
  page.$$=async()=>[{async evaluate(fn){return fn({getAttribute:()=>null,getBoundingClientRect:()=>({width:1,height:1}),click(){clicks++;}});},async dispose(){}}];
  const tab=await createAdsPowerPage({page,profileId:'test',tabId:'tab-1'}),auth={kind:'catalog_create',expectedActorId:'111',businessId:'123'};
  await tab.creatorClick('observed-selector',auth);assert.equal(clicks,1);
  await assert.rejects(tab.creatorClick('observed-selector',{...auth,businessId:'456'}),rejected('CATALOG_CREATE_CONTEXT_REQUIRED'));
  await assert.rejects(tab.creatorClick('observed-selector',{...auth,expectedActorId:'999'}),rejected('IDENTITY_CHANGED'));
  page.url=()=> 'https://business.facebook.com/products/catalogs/new/?business_id=123';
  await tab.creatorClick('observed-selector',auth);assert.equal(clicks,2);
  page.url=()=> 'https://adsmanager.facebook.com/adsmanager/manage/?business_id=123';
  await assert.rejects(tab.creatorClick('observed-selector',auth),rejected('CATALOG_CREATE_CONTEXT_REQUIRED'));assert.equal(clicks,2);
});

test('catalog field replacement bypasses a framework value tracker and verifies exact value',async()=>{
  const page=pageFixture();page.url=()=> 'https://business.facebook.com/commerce/catalogs/123/';
  let actual='目录_默认',tracked=actual;const events=[];
  class Input {get value(){return actual;}set value(v){actual=v;}}
  const input=new Input();Object.assign(input,{tagName:'INPUT',type:'text',name:'catalog_name',dispatchEvent(event){events.push(event.type);if(event.type==='input')tracked=actual;}});
  Object.defineProperty(input,'value',{get:()=>actual,set:v=>{actual=v;tracked=v;}});
  const context=vm.createContext({input,HTMLInputElement:Input,HTMLTextAreaElement:Input,Event:class{constructor(type){this.type=type;}}});
  page.$$=async()=>[{async evaluate(fn,value){context.value=value;return vm.runInContext(`(${fn.toString()})(input,value)`,context);},async dispose(){}}];
  const tab=await createAdsPowerPage({page,profileId:'test',tabId:'tab-1'});
  const result=await tab.fill('input','METAPAPA 测试',{kind:'catalog_write',expectedActorId:'111',catalogId:'123'});
  assert.equal(actual,'METAPAPA 测试');assert.equal(tracked,actual);assert.deepEqual(events,['input','change']);assert.equal(result.value_verified,true);assert.equal(result.saved,false);
});
test('disabled catalog controls never dispatch clicks',async()=>{
  const page=pageFixture();page.url=()=> 'https://business.facebook.com/commerce/catalogs/123/';let clicks=0;
  page.$$=async()=>[{async evaluate(fn){return fn({disabled:true,click(){clicks++;}});},async dispose(){}}];
  const tab=await createAdsPowerPage({page,profileId:'test',tabId:'tab-1'});
  await assert.rejects(tab.click('button',{kind:'catalog_write',expectedActorId:'111',catalogId:'123'}),rejected('ADSPOWER_PAGE_OPERATION_UNCONFIRMED'));assert.equal(clicks,0);
});
