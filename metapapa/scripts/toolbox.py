#!/usr/bin/env python3
"""Account timezone, TOTP, and Facebook ID helpers. JSON input/output; no network requests."""
import argparse, base64, hashlib, hmac, json, os, re, struct, sys, time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl
from zoneinfo import ZoneInfo


def safe_url(value):
    u = urlsplit(value)
    if u.scheme not in ('https','http') or not u.hostname or u.username or u.password: raise ValueError('An http(s) URL without credentials is required')
    return u

def timezone(p):
    naive=datetime.fromisoformat(p['datetime'])
    if naive.tzinfo: raise ValueError('Provide a naive local datetime plus from_zone')
    zone=ZoneInfo(p['from_zone']); possible=[]
    for fold in (0,1):
        candidate=naive.replace(tzinfo=zone,fold=fold)
        if candidate.astimezone(ZoneInfo('UTC')).astimezone(zone).replace(tzinfo=None)==naive:
            if not possible or candidate.utcoffset()!=possible[0].utcoffset(): possible.append(candidate)
    if not possible: raise ValueError('NONEXISTENT_DST_LOCAL_TIME')
    if len(possible)>1 and 'fold' not in p: raise ValueError('AMBIGUOUS_DST_LOCAL_TIME: specify fold 0 or 1')
    if p.get('fold',0) not in (0,1): raise ValueError('fold must be 0 or 1')
    source=possible[p.get('fold',0)] if len(possible)>1 else possible[0]
    return {'source':source.isoformat(),'target':source.astimezone(ZoneInfo(p['to_zone'])).isoformat()}

def totp(p):
    # Send the secret over stdin, never a command-line argument or persisted job log.
    key=re.sub(r'\s+','',p['secret']).upper(); key+='='*((8-len(key)%8)%8)
    key=base64.b32decode(key); digits=int(p.get('digits',6)); step=int(p.get('step',30)); now=int(p.get('time',time.time()))
    if digits not in (6,8) or step<=0 or now<0: raise ValueError('Invalid TOTP parameters')
    algorithm=p.get('algorithm','sha1')
    if algorithm not in ('sha1','sha256','sha512'): raise ValueError('Unsupported TOTP algorithm')
    digest=hmac.new(key,struct.pack('>Q',now//step),getattr(hashlib,algorithm)).digest()
    offset=digest[-1]&15; value=(struct.unpack('>I',digest[offset:offset+4])[0]&0x7fffffff)%10**digits
    return {'code':str(value).zfill(digits),'valid_seconds':step-now%step}

def facebook_id(p):
    text=p['value'].strip()
    if re.fullmatch(r'\d+',text): return {'id':text,'source':'numeric_input','ownership_verified':False}
    u=safe_url(text)
    if u.hostname not in ('facebook.com','www.facebook.com','m.facebook.com','business.facebook.com','adsmanager.facebook.com'): raise ValueError('Not a supported Facebook URL')
    query=dict(parse_qsl(u.query))
    candidates=[query.get(k) for k in ('id','act','business_id','story_fbid') if query.get(k,'').isdigit()]
    candidates += re.findall(r'(?:^|/)(\d+)(?=/|$)',u.path)
    return {'ids':list(dict.fromkeys(candidates)),'source':'url_syntax','ownership_verified':False,'next':None if candidates else 'Use facebook_id_public.py for anonymous lookup first; if unresolved and Chrome is allowed, follow onboarding.md then facebook-id.mjs.'}

def output_file(value):
    path=Path(value).expanduser().resolve()
    if path.exists(): raise ValueError('OUTPUT_EXISTS: choose a new output path')
    path.parent.mkdir(parents=True,exist_ok=True)
    return str(path)

def run(action,p):
    if action=='timezone': return timezone(p)
    if action=='totp': return totp(p)
    if action=='facebook.id': return facebook_id(p)
    if action=='doctor': return {'python':sys.version.split()[0],'dependencies':'Python standard library only','network':'local toolbox makes no network requests'}
    raise ValueError('UNKNOWN_TOOL: '+action)

def main():
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('action'); parser.add_argument('--input',type=Path,help='JSON job file; omit to read JSON from stdin'); parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    if args.action=='totp' and (args.input or args.output): parser.error('TOTP uses stdin/stdout only; do not persist secrets or codes')
    try:
        params=json.loads(args.input.read_text() if args.input else (sys.stdin.read() or '{}'))
        result=run(args.action,params); data=json.dumps(result,ensure_ascii=False,indent=2)
        if args.output:
            with open(output_file(args.output),'x',encoding='utf8') as f: os.chmod(f.name,0o600); f.write(data+'\n')
        else: print(data)
    except (ValueError,KeyError,TypeError,ArithmeticError,OSError) as exc:
        print(json.dumps({'error':str(exc)},ensure_ascii=False),file=sys.stderr); return 2
    return 0
if __name__=='__main__': sys.exit(main())
