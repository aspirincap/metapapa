import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {normalizeProfileUrl,parseProfileRoute,createFacebookIdClient} from '../../metapapa/scripts/facebook-id.mjs';

const target=()=>normalizeProfileUrl('https://www.facebook.com/example.page');
function route(id='123'){
  const view={entryPoint:{__dr:'ProfileCometTimelineListViewRouteRoot.entrypoint'},resource:{__dr:'ProfileCometTimelineListViewRoot.react'},props:{userID:id,userVanity:'example.page',viewerID:'999'}};
  return {canonicalRouteName:'comet.fbweb.CometProfileTimelineListViewRoute',url:'/example.page',params:{vanity:'example.page'},rootView:structuredClone(view),hostableView:structuredClone(view)};
}
const roots=r=>[{require:[['bootstrap',null,null,[{initialRouteInfo:{route:r}}]]]}];

function browser(options={}){
  let calls=0,actor='999',lastFetch;
  const context={URL,performance,AbortSignal,location:{origin:options.origin||'https://www.facebook.com'},require:()=>({USER_ID:actor}),
    DOMParser:class{parseFromString(){return{querySelector:()=>options.challenge?{}:null,querySelectorAll:()=>options.noRoute?[]:[{textContent:JSON.stringify(roots(options.route||route()))}]};}},
    fetch:async(url,init)=>{
      calls++;lastFetch={url,init};if(options.throwFetch)throw new Error('interrupted');if(options.switchActor)actor='888';
      return {ok:!options.httpError,status:options.httpError||200,url,headers:{get:()=>options.contentType||'text/html; charset=utf-8'},text:async()=>'<html>DO_NOT_EXPORT_RAW_RESPONSE</html>'};
    }
  };
  const cdp={send:async(method,p)=>{assert.equal(method,'Runtime.evaluate');return {result:{value:await vm.runInNewContext(p.expression,context)}};}};
  return {cdp,get calls(){return calls;},get lastFetch(){return lastFetch;},setActor(v){actor=v;}};
}

test('profile URL normalization drops tracking and rejects unrelated or unsafe routes',()=>{
  assert.deepEqual(normalizeProfileUrl('http://m.facebook.com/Example.Page/?ref=abc#section'),target());
  assert.deepEqual(normalizeProfileUrl('https://facebook.com/profile.php?id=123&ref=test'),{url:'https://www.facebook.com/profile.php?id=123',kind:'numeric',key:'123'});
  for(const url of ['https://www.facebook.com.evil.test/example','https://user:pass@facebook.com/example','https://facebook.com:8080/example','https://facebook.com/logout','https://facebook.com/logout.php','https://facebook.com/photo.php?fbid=123','https://facebook.com/groups/123','https://facebook.com/example/posts/123','https://facebook.com/profile.php?id=123&id=456','https://facebook.com/%65xample','https://facebook.com/example\\other',' https://facebook.com/example'])assert.throws(()=>normalizeProfileUrl(url),e=>e.code==='INVALID_PROFILE_URL');
});

test('profile routing identifies target independently of viewer, photos and story buckets',()=>{
  const data=[{id:'999',__typename:'User'},{id:'456',__typename:'Photo'},{id:'789',__typename:'DirectMessageThreadBucket'},...roots(route())];
  const out=parseProfileRoute(data,target());assert.equal(out.ok,true);assert.equal(out.data.profile_id,'123');assert.equal(out.data.id_type,'profile_id');
  assert.equal(parseProfileRoute(data,normalizeProfileUrl('https://facebook.com/123')).data.profile_id,'123');
});

test('missing target binding or changed operation definitions never select another profile',()=>{
  for(const modify of [r=>r.url='/other',r=>r.params.vanity='other',r=>r.rootView.props.userVanity='other',r=>r.canonicalRouteName='DifferentRoute',r=>r.rootView.entryPoint.__dr='Unknown.entrypoint',r=>r.rootView.props.userID=123]){
    const r=route();modify(r);assert.deepEqual(parseProfileRoute(roots(r),target()),{ok:false,code:'PROFILE_ROUTE_NOT_FOUND'});
  }
  const r=route();r.hostableView.props.userID='456';assert.equal(parseProfileRoute(roots(r),target()).code,'PROFILE_ROUTE_CONFLICT');
});

test('conflicting routes reject; duplicate identical routes are safe',()=>{
  assert.equal(parseProfileRoute([...roots(route()),...roots(route('456'))],target()).code,'AMBIGUOUS_PROFILE_ROUTE');
  assert.equal(parseProfileRoute([...roots(route()),...roots(route())],target()).data.profile_id,'123');
});

test('one read-only browser GET returns minimal identity without HTML or credentials',async()=>{
  const b=browser(),client=createFacebookIdClient({cdp:b.cdp,expectedActorId:'999'});
  const out=await client.resolve({url:'https://facebook.com/example.page?ref=abc'});
  assert.equal(out.status,'resolved');assert.equal(out.profile_id,'123');assert.equal(out.request_count,1);assert.equal(b.calls,1);
  assert.equal(b.lastFetch.url,'https://www.facebook.com/example.page');assert.equal(b.lastFetch.init.method,'GET');assert.equal(b.lastFetch.init.redirect,'error');assert.equal(b.lastFetch.init.credentials,'include');
  assert(!JSON.stringify(out).includes('DO_NOT_EXPORT'));assert(!('actor_id' in out));assert(!('viewerID' in out));
  b.setActor('888');await assert.rejects(client.resolve({url:target().url}),e=>e.code==='IDENTITY_CHANGED');assert.equal(b.calls,1);
});

test('wrong origin, login, invalid input and actor changes stop rather than using unrelated IDs',async()=>{
  for(const [options,actor,code,calls] of [[{origin:'https://example.test'},'999','FACEBOOK_WWW_PAGE_REQUIRED',0],[{},'0','LOGIN_REQUIRED',0],[{switchActor:true},'999','IDENTITY_CHANGED',1]]){
    const b=browser(options);b.setActor(actor);await assert.rejects(createFacebookIdClient({cdp:b.cdp}).resolve({url:target().url}),e=>e.code===code);assert.equal(b.calls,calls);
  }
  const b=browser(),client=createFacebookIdClient({cdp:b.cdp});
  await assert.rejects(client.resolve({url:target().url,timeoutMs:0}),e=>e.code==='INVALID_TIMEOUT');
  await assert.rejects(client.resolve({url:'https://facebook.com/logout.php'}),e=>e.code==='INVALID_PROFILE_URL');assert.equal(b.calls,0);
});

test('rate limits, redirects, challenge pages and incompatible response shapes fail without retries',async()=>{
  for(const [options,code] of [[{httpError:429},'RATE_LIMITED'],[{httpError:403},'ACCESS_DENIED'],[{throwFetch:true},'PROFILE_GET_UNAVAILABLE'],[{challenge:true},'LOGIN_OR_CHALLENGE_REQUIRED'],[{noRoute:true},'PROFILE_ROUTE_NOT_FOUND'],[{contentType:'application/json'},'PROFILE_RESPONSE_NOT_HTML']]){
    const b=browser(options);await assert.rejects(createFacebookIdClient({cdp:b.cdp}).resolve({url:target().url}),e=>e.code===code);assert.equal(b.calls,1);
  }
});

test('browser transport interruption returns a read-only failure',async()=>{
  const client=createFacebookIdClient({cdp:{send:async()=>{throw new Error('transport lost');}}});
  await assert.rejects(client.resolve({url:target().url}),e=>e.code==='BROWSER_READ_UNAVAILABLE');
});
