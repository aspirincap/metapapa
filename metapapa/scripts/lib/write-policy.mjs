import {OperationError} from './common.mjs';

// In restricted mode, only known operations that cannot target an ad account
// are allowed. Generic asset/person mutations stay blocked without type proof.
const NON_AD_WRITES = new Set(['pages.create','pages.createInBusiness','businesses.create',
  'friends.send','friends.cancel','friends.confirm','friends.delete',
  'comments.remove','comments.hide','datasets.create','datasets.users.remove']);
export function normalizeWritePolicy(value='no_ad_account_writes') {
  if(!['no_ad_account_writes','read_only','standard'].includes(value))throw new OperationError('INVALID_WRITE_POLICY');
  return value;
}
export function assertWriteAllowed(op,policy='no_ad_account_writes') {
  normalizeWritePolicy(policy);
  if(!op.write)return;
  if(policy==='read_only')throw new OperationError('READ_ONLY_MODE','This task permits reads only.',{submitted:false});
  if(policy==='no_ad_account_writes'&&!NON_AD_WRITES.has(op.name))
    throw new OperationError('AD_ACCOUNT_WRITES_FORBIDDEN','Ad account writes and untyped asset/permission mutations are disabled.',{submitted:false,operation:op.name});
}
