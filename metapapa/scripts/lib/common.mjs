import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {dirname} from 'node:path';

export class OperationError extends Error {
  constructor(code, message = code, details = {}) {
    super(message); this.name = 'OperationError'; this.code = code; this.details = redact(details);
  }
}
const sensitive = /(?:api.?key|access.?token|authorization|cookie|password|secret|fb_dtsg|jazoest|^lsd$|file_meta|encpass|^xs$|^datr$)/i;
export function redact(value, depth = 0) {
  if (depth > 16) return '[TRUNCATED]';
  if (typeof value === 'string') {
    let text = value.replace(/\bEAA[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
      .replace(/\bBearer\s+[^\s"<>]+/gi, 'Bearer [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
    text = text.replace(/([?&](?:access_token|fb_dtsg|lsd|jazoest|token)=)[^&#\s]*/gi, '$1[REDACTED]');
    return text;
  }
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !['__proto__', 'constructor', 'prototype'].includes(k))
    .map(([k,v]) => [k, sensitive.test(k) ? '[REDACTED]' : redact(v, depth + 1)]));
  return value;
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const stamp = () => new Date().toISOString();
export async function atomicJSON(path, value) {
  await mkdir(dirname(path), {recursive:true});
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(redact(value), null, 2)+'\n', {mode:0o600});
  await rename(tmp,path);
}
export async function createJournal(path, initial) {
  await mkdir(dirname(path), {recursive:true});
  const state = {version:1, ...initial, created_at:stamp(), events:[]};
  try {await writeFile(path, JSON.stringify(redact(state)), {flag:'wx', mode:0o600});}
  catch(e) {if(e.code==='EEXIST')throw new OperationError('JOURNAL_EXISTS','Inspect and reconcile the existing task before another write.');throw e;}
  return {state, async record(status, details={}) {
    state.state=status;state.updated_at=stamp();state.events.push({status,at:stamp(),...redact(details)});
    await atomicJSON(path,state);return state;
  }};
}
export async function readJournal(path) {return JSON.parse(await readFile(path,'utf8'));}
export function numericId(value, label='id') {
  if (typeof value !== 'string' || !/^[1-9]\d{0,29}$/.test(value)) throw new OperationError('INVALID_INPUT',`${label} must be a numeric string, preserving precision.`);
  return value;
}
export function requiredString(value,label,max=500) {
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new OperationError('INVALID_INPUT',`${label} must contain 1–${max} characters.`);
  return value;
}
export function parseFacebookText(text) {
  const input=String(text).replace(/^\s*for\s*\(;;\);\s*/, '');
  try{return JSON.parse(input);}catch{}
  const lines=input.split('\n').filter(s=>s.trim());
  try {const frames=lines.map(s=>JSON.parse(s));return frames.length===1?frames[0]:{frames};}
  catch {throw new OperationError('RESPONSE_NOT_JSON','Response may be login, checkpoint or an incompatible page.');}
}
export function checkBody(body) {
  if (body?.error || body?.errors?.length || body?.success===false) throw new OperationError('META_BUSINESS_ERROR', 'Facebook returned a business error.', {error:body.error,errors:body.errors,errorSummary:body.errorSummary,errorDescription:body.errorDescription});
  if (body?.frames) for(const frame of body.frames)checkBody(frame);
  return body;
}
