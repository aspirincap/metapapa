import {OperationError,numericId,requiredString} from './common.mjs';
import {readFileSync} from 'node:fs';
const evidence=JSON.parse(readFileSync(new URL('../../references/verification.json',import.meta.url),'utf8'));

const A='https://adsmanager-graph.facebook.com';
const G='https://graph.facebook.com';
export const B='https://business.facebook.com';
export const F='https://www.facebook.com';
const registry=new Map();
const id=(p,k)=>numericId(p[k],k);
const str=(p,k,max)=>requiredString(p[k],k,max);
const choice=(p,k,values,defaultValue)=>{const value=p[k]??defaultValue;if(!values.includes(value))throw new OperationError('INVALID_INPUT',`${k}: expected ${values.join(', ')}`);return value;};
const integer=(p,k,min,max,defaultValue)=>{const v=p[k]??defaultValue;if(!Number.isSafeInteger(v)||v<min||v>max)throw new OperationError('INVALID_INPUT',`${k}: expected integer ${min}..${max}`);return v;};
const tasks=p=>{if(!Array.isArray(p.tasks)||!p.tasks.length||p.tasks.some(t=>!['ADVERTISE','ANALYZE','DRAFT','MANAGE'].includes(t)))throw new OperationError('INVALID_INPUT','Explicit permitted tasks required');return p.tasks.join(',');};
const listIds=(p,k)=>{if(!Array.isArray(p[k])||!p[k].length||p[k].length>100)throw new OperationError('INVALID_INPUT',`${k}: expected 1..100 IDs`);return p[k].map(v=>numericId(v,k));};
const dateRange=p=>{for(const k of ['since','until'])if(!/^\d{4}-\d{2}-\d{2}$/.test(p[k]||'')||!Number.isFinite(Date.parse(p[k]))||new Date(p[k]).toISOString().slice(0,10)!==p[k])throw new OperationError('INVALID_INPUT',`${k}: valid YYYY-MM-DD required`);if(p.since>p.until)throw new OperationError('INVALID_INPUT','since must precede until');return {since:p.since,until:p.until};};
const compositeId=(p,k)=>{const value=str(p,k,100);if(!/^[1-9]\d*(?:_[1-9]\d*)?$/.test(value))throw new OperationError('INVALID_INPUT',`${k}: numeric or composite Facebook ID required`);return value;};
function add(name,description,params,build,{write=false,paginated=false,source='',verification,verify}={}){
 registry.set(name,{name,description,params,build,write,paginated,source,verification:verification||(write?'implemented_unverified_write':'implemented_pending_live'),verify});
}
const graph=(path,query={},body,version=16,origin=A)=>({kind:'graph',origin,path:`/v${version}.0/${path}`,method:body?'POST':'GET',query,body});
const gql=(origin,friendlyName,docId,variables,actingProfileId)=>({kind:'graphql',origin,pageOrigin:origin,path:'/api/graphql/',method:'POST',friendlyName,docId,variables,actingProfileId});
const edge=(name,title,path,fields,params=[],version=16,origin=A)=>add(name,title,[...params,'limit?','after?'],p=>graph(path(p),{fields,limit:integer(p,'limit',1,500,100),after:p.after===undefined?undefined:str(p,'after',4000)},undefined,version,origin),{paginated:true});
const get=(name,title,path,fields,params=[],version=16,origin=A)=>add(name,title,params,p=>graph(path(p),{fields},undefined,version,origin));
const write=(name,title,params,build,verify)=>add(name,title,params,build,{write:true,verify});

get('identity.me','当前网页 Token 的 Facebook 身份',()=> 'me','id,name');
edge('accounts.list','广告账户列表',()=> 'me/adaccounts','id,account_id,name,account_status,currency,timezone_name,business,amount_spent,balance');
get('accounts.get','广告账户详情',p=>`act_${id(p,'accountId')}`,'id,account_id,name,account_status,currency,timezone_name,business,amount_spent,balance,spend_cap',['accountId']);
get('accounts.access','账户人员与权限原始关系',p=>`act_${id(p,'accountId')}`,'id,name,users.limit(500),userpermissions.limit(500),agencies,owner_business',['accountId']);
get('accounts.spendCap','账户花费限额',p=>`act_${id(p,'accountId')}`,'id,spend_cap,currency',['accountId']);
write('accounts.rename','重命名广告账户',['accountId','name'],p=>graph(`act_${id(p,'accountId')}`,{}, {name:str(p,'name',255)},18),p=>({operation:'accounts.get',params:{accountId:p.accountId},expected:{name:p.name}}));
write('accounts.spendCap.set','设置账户限额，保持接口金额单位',['accountId','amount'],p=>{if(typeof p.amount!=='string'||!/^\d+(\.\d+)?$/.test(p.amount))throw new OperationError('INVALID_INPUT','amount must be a nonnegative decimal string in the API unit');return graph(`act_${id(p,'accountId')}`,{},{spend_cap:p.amount});},p=>({operation:'accounts.spendCap',params:{accountId:p.accountId},expected:{spend_cap:p.amount}}));
write('accounts.spendCap.remove','移除账户限额',['accountId'],p=>graph(`act_${id(p,'accountId')}`,{},{spend_cap_action:'delete'}));
write('accounts.users.add','添加广告账户人员',['accountId','userId','role'],p=>graph(`act_${id(p,'accountId')}/users`,{},{uid:id(p,'userId'),role:choice(p,'role',['1001','1002','1003'])}));
write('accounts.users.remove','移除广告账户人员',['accountId','userId'],p=>graph(`act_${id(p,'accountId')}/users/${id(p,'userId')}`,{method:'DELETE'}));
write('accounts.partners.add','分享广告账户给伙伴',['accountId','businessId','tasks'],p=>{const tasks=p.tasks;if(!Array.isArray(tasks)||!tasks.length||tasks.some(t=>!['ADVERTISE','ANALYZE','DRAFT','MANAGE'].includes(t)))throw new OperationError('INVALID_INPUT','Invalid permitted tasks');return graph(`act_${id(p,'accountId')}/agencies`,{},{business:id(p,'businessId'),adaccount_id:p.accountId,permitted_tasks:tasks.join(',')});});
write('accounts.currency.set','修改账户币种',['accountId','currency'],p=>{if(!/^[A-Z]{3}$/.test(p.currency||''))throw new OperationError('INVALID_INPUT','currency must be ISO-style uppercase code');return graph(`act_${id(p,'accountId')}`,{method:'POST',currency:p.currency});});
write('accounts.timezone.set','修改账户时区',['accountId','timezoneId'],p=>graph(`act_${id(p,'accountId')}`,{method:'POST',timezone_id:integer(p,'timezoneId',0,1000)}));

edge('businesses.list','BM 列表',()=> 'me/businesses','id,name,verification_status,created_time');
get('businesses.get','BM 基本资料',p=>id(p,'businessId'),'id,name,verification_status,created_time,primary_page',['businessId']);
edge('businesses.members.list','BM 人员',p=>`${id(p,'businessId')}/business_users`,'id,name,email,role,pending_email',['businessId']);
edge('businesses.systemUsers.list','BM 系统用户',p=>`${id(p,'businessId')}/system_users`,'id,name,role',['businessId'],25,G);
edge('businesses.accounts.owned','BM 自有广告账户',p=>`${id(p,'businessId')}/owned_ad_accounts`,'id,account_id,name,account_status,currency',['businessId']);
edge('businesses.accounts.client','BM 客户广告账户',p=>`${id(p,'businessId')}/client_ad_accounts`,'id,account_id,name,account_status,currency',['businessId']);
edge('businesses.pages.owned','BM 自有主页',p=>`${id(p,'businessId')}/owned_pages`,'id,name',['businessId'],25,G);
get('businesses.partners','BM 伙伴关系首屏',p=>id(p,'businessId'),'id,partner_relationships.limit(100){id,name}',['businessId']);
write('businesses.accounts.attach','将广告账户关联至 BM',['businessId','accountId','tasks'],p=>graph(`${id(p,'businessId')}/client_ad_accounts`,{},{adaccount_id:'act_'+id(p,'accountId'),access_type:'AGENCY',method:'post',permitted_tasks:tasks(p)}));
write('businesses.accounts.remove','移除 BM 客户广告账户关系',['businessId','accountId'],p=>graph(`${id(p,'businessId')}/client_ad_accounts`,{},{method:'delete',adaccount_id:'act_'+id(p,'accountId')}));
write('businesses.members.remove','移除 BM 人员',['businessUserId'],p=>graph(id(p,'businessUserId'),{method:'DELETE'}));

edge('pages.list','当前身份可访问主页',()=> 'me/accounts','id,name,category,tasks',[],18,G);
get('pages.get','主页基本资料',p=>id(p,'pageId'),'id,name,category,link',['pageId'],18,G);
edge('pages.posts.list','主页帖子',p=>`${id(p,'pageId')}/posts`,'id,message,created_time,permalink_url',['pageId'],18,G);
edge('pixels.list','BM 自有像素',p=>`${id(p,'businessId')}/adspixels`,'id,name,owner_business',['businessId']);
get('pixels.get','像素详情',p=>id(p,'pixelId'),'id,name,owner_business',['pixelId']);
get('pixels.users','像素分配人员',p=>id(p,'pixelId'),'assigned_users{id,name,tasks}',['pixelId']);
get('pixels.partners','像素分配伙伴',p=>id(p,'pixelId'),'assigned_partners{id,name}',['pixelId']);
add('pixels.accounts','像素可用广告账户',['pixelId','businessId'],p=>graph(id(p,'pixelId'),{fields:`permissible_ad_accounts.limit(100).business(${id(p,'businessId')})`}));
write('pixels.accounts.share','旧像素共享账户接口',['pixelId','businessId','accountId'],p=>graph(`${id(p,'pixelId')}/shared_accounts`,{method:'POST',business:id(p,'businessId'),account_id:id(p,'accountId')}));

for(const [level,edgeName] of [['campaign','campaigns'],['adset','adsets'],['ad','ads']]){
 edge(`ads.${edgeName}.list`,`${edgeName} 列表`,p=>`act_${id(p,'accountId')}/${edgeName}`,'id,name,status,effective_status',['accountId']);
}
get('ads.object.get','广告对象基本状态',p=>id(p,'objectId'),'id,name,status,effective_status',['objectId'],23);
add('ads.insights.query','按明确日期和层级查询指标',['accountId','since','until','level?','limit?','after?'],p=>graph(`act_${id(p,'accountId')}/insights`,{time_range:dateRange(p),level:choice(p,'level',['account','campaign','adset','ad'],'account'),fields:'account_id,account_currency,campaign_id,adset_id,ad_id,date_start,date_stop,spend,impressions,clicks,reach,actions,cost_per_action_type',limit:integer(p,'limit',1,500,100),after:p.after},undefined,18),{paginated:true});
add('ads.accountResults','账户 am_tabular 结果指标',['accountId','since','until'],p=>graph(`act_${id(p,'accountId')}/am_tabular`,{time_range:dateRange(p),column_fields:'results,cost_per_result,spend',level:'account',limit:1000}));
write('ads.status.set','修改广告对象启停状态',['objectId','status'],p=>graph(id(p,'objectId'),{},{status:choice(p,'status',['ACTIVE','PAUSED'])},23),p=>({operation:'ads.object.get',params:{objectId:p.objectId},expected:{status:p.status}}));
add('targeting.search','兴趣关键词搜索',['accountId','query','locale?','countries?'],p=>graph(`act_${id(p,'accountId')}/targetingsearch`,{q:str(p,'query',250),locale:p.locale||'en_US',countries:p.countries||['US'],limit:500,fields:'id,name,type,path,audience_size_lower_bound,audience_size_upper_bound,description',objective:'LINK_CLICKS'}));
add('targeting.browse','兴趣与人口统计分类',['accountId','locale?'],p=>graph(`act_${id(p,'accountId')}/targetingbrowse`,{locale:p.locale||'en_US',countries:['US'],include_nodes:true,fields:'id,name,type,path,key,parent,description,audience_size_lower_bound,audience_size_upper_bound'}));
edge('comments.list','帖子评论',p=>`${compositeId(p,'postId')}/comments`,'id,message,created_time,from,attachment,is_hidden',['postId'],18,G);
write('comments.remove','删除指定评论',['commentId'],p=>graph(compositeId(p,'commentId'),{method:'DELETE'},undefined,18,G));
write('datasets.create','创建 Dataset',['businessId','name'],p=>({kind:'web',origin:B,pageOrigin:B,path:'/events_manager/dataset/create/',method:'POST',query:{business_id:id(p,'businessId'),is_crm:false,name:str(p,'name',255)},body:{__bid:p.businessId}}));

// These are web-session Graph endpoints, not an application/OAuth integration.
edge('catalogs.list','BM 自有商品目录',p=>`${id(p,'businessId')}/owned_product_catalogs`,'id,name,product_count,vertical',['businessId'],18,G);
get('catalogs.get','商品目录详情',p=>id(p,'catalogId'),'id,name,product_count,vertical',['catalogId'],18,G);
edge('catalogs.products.list','商品列表',p=>`${id(p,'catalogId')}/products`,'id,retailer_id,name,description,availability,condition,price,currency,brand,url,image_url',['catalogId'],18,G);
get('catalogs.products.get','商品详情',p=>id(p,'productId'),'id,retailer_id,name,description,availability,condition,price,currency,brand,url,image_url',['productId'],18,G);
edge('catalogs.productSets.list','商品集列表',p=>`${id(p,'catalogId')}/product_sets`,'id,name,filter,product_count',['catalogId'],18,G);
get('catalogs.productSets.get','商品集详情',p=>id(p,'productSetId'),'id,name,filter,product_count',['productSetId'],18,G);
// Catalog graph methods are pending page-call evidence; surfaced as experimental below.
for(const entry of registry.values())if(entry.name.startsWith('catalogs.'))entry.verification='experimental_graph_requires_live_verification';

export function registerGraphQL({name,description,params,origin,friendlyName,docId,variables,write:mutates=false,actingProfile,source}){
 add(name,description,params,(p,session)=>gql(origin,friendlyName,docId,variables(p,session),actingProfile?.(p,session)),{write:mutates,source});
}
export const validators={id,str,choice,integer,listIds,dateRange,compositeId};
export function operation(name){const op=registry.get(name);if(!op)throw new OperationError('CAPABILITY_UNAVAILABLE',name);return op;}
export function capabilities(){return [...registry.values()].map(({build,verify,...rest})=>{
 const proof=evidence.checks.find(x=>x.operation===rest.name&&x.ok);
 return {...rest,verification:proof&&!rest.write?'read_verified_'+evidence.date.slice(0,10):rest.verification,verified_at:proof?evidence.date:null};
});}
export function buildOperation(name,params={},session){
 const op=operation(name);if(!params||Array.isArray(params)||typeof params!=='object')throw new OperationError('INVALID_INPUT');
 const allowed=new Set(op.params.map(k=>k.replace(/\?$/,'')));
 for(const key of Object.keys(params))if(!allowed.has(key))throw new OperationError('INVALID_INPUT',`Unknown parameter ${key} for ${name}`);
 return {op,request:op.build(params,session)};
}
