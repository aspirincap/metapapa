import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeInsights,rowsToCSV} from '../../metapapa/scripts/report.mjs';
test('report preserves partial flag, decimal cents, and currencies',()=>{const result=summarizeInsights({complete:false,reason:'page_limit',data:[{account_currency:'USD',spend:'0.1',clicks:'1',impressions:'2'},{account_currency:'USD',spend:'0.2'},{account_currency:'EUR',spend:'2.00'}]});assert.equal(result.complete,false);assert.equal(result.groups[0].spend,'0.30');assert.equal(result.groups.length,2);});
test('CSV neutralizes formulas and quotes multiline data',()=>{const csv=rowsToCSV([{id:'001',name:'=HYPERLINK("x")',note:'a\nb'}],['id','name','note']);assert(csv.includes('"\'=HYPERLINK'));assert(csv.includes('"a\nb"'));assert(csv.startsWith('\ufeff'));});
test('unexpected monetary precision does not silently round',()=>assert.throws(()=>summarizeInsights({data:[{spend:'1.111'}]}),e=>e.code==='UNEXPECTED_SPEND_FORMAT'));
