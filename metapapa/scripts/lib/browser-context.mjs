import {OperationError} from './common.mjs';
export function browserContext(cdp) {
  const value=cdp?.context;
  if(!value)return null;
  if(value.provider!=='adspower'||typeof value.profile_id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(value.profile_id))throw new OperationError('INVALID_BROWSER_CONTEXT');
  return Object.freeze({provider:'adspower',profile_id:value.profile_id});
}
export function assertBrowserContext(recorded,current) {
  if(JSON.stringify(recorded??null)!==JSON.stringify(current??null))throw new OperationError('BROWSER_PROFILE_MISMATCH','Use the original browser profile for this task or journal.',{submitted:false});
}
