import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {OperationError,redact,atomicJSON} from './lib/common.mjs';
const plain=v=>String(v??'').replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');
const cell=v=>{const s=String(v??'');return '"'+(/^[=+@\-\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';};
export function rowsToCSV(rows,columns){if(!Array.isArray(rows))throw new OperationError('INVALID_ROWS');return '\ufeff'+[columns.map(cell).join(','),...rows.map(r=>columns.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';}
export function summarizeInsights(snapshot){
 if(!Array.isArray(snapshot.data))throw new OperationError('PAGINATED_INSIGHTS_REQUIRED');
 const groups={};
 for(const row of snapshot.data){const currency=row.account_currency||'UNKNOWN';const g=groups[currency]??={currency,rows:0,spend_minor:0n,impressions:0,clicks:0};g.rows++;
  const spend=String(row.spend??'0');if(!/^\d+(?:\.\d{1,2})?$/.test(spend))throw new OperationError('UNEXPECTED_SPEND_FORMAT','Expected up to two decimal places; do not round silently.');
  const [whole,decimal='']=spend.split('.');g.spend_minor+=BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0'));
  for(const key of ['impressions','clicks']){const n=Number(row[key]??0);if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(g[key]+n))throw new OperationError('UNSAFE_METRIC_VALUE');g[key]+=n;}
 }
 return {complete:snapshot.complete===true,reason:snapshot.reason,groups:Object.values(groups).map(({spend_minor,...g})=>({...g,spend:`${spend_minor/100n}.${String(spend_minor%100n).padStart(2,'0')}`})),note:'Do not combine overlapping dates or different reporting levels. Reach, actions and attribution results are not summed.'};
}
export async function exportReport({path,snapshot,context={}}){
 const summary=summarizeInsights(snapshot);const lines=['# Meta 广告数据报告','',`读取状态：${summary.complete?'完整分页':'不完整 — '+plain(summary.reason||'未确认')}`,'',`账户时区：${plain(context.accountTimezone||'未提供')}；日期：${plain(context.since)} 至 ${plain(context.until)}；层级：${plain(context.level||'未提供')}`,'','| 币种 | 行数 | 花费 | 展示 | 点击 |','|---|---:|---:|---:|---:|',...summary.groups.map(g=>`| ${plain(g.currency)} | ${g.rows} | ${g.spend} | ${g.impressions} | ${g.clicks} |`),'',summary.note,''];
 await mkdir(dirname(path),{recursive:true});await writeFile(path,lines.join('\n'),{flag:'wx',mode:0o600});return {path,summary};
}
export async function exportSnapshot(path,snapshot){await atomicJSON(path,{schema:'metapapa.snapshot.v1',...redact(snapshot)});return {path};}
