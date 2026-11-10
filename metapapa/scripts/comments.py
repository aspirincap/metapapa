#!/usr/bin/env python3
"""Preview matching comments locally without submitting any Meta action."""
import argparse, json, os, sys
from pathlib import Path

def comment_preview(p):
    keywords=p.get('keywords',[]); excluded=set(p.get('exclude_author_ids',[])); matches=[]
    for comment in p['comments']:
        text=comment.get('message',''); author=str(comment.get('from',{}).get('id',''))
        found=[k for k in keywords if k.casefold() in text.casefold()]
        if found and author not in excluded: matches.append({'comment_id':comment['id'],'matched_keywords':found,'proposed_action':p.get('action','hide')})
    return {'matches':matches,'count':len(matches),'executed':False}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,help='JSON job file; omit to read JSON from stdin')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    try:
        params=json.loads(args.input.read_text() if args.input else (sys.stdin.read() or '{}'))
        data=json.dumps(comment_preview(params),ensure_ascii=False,indent=2)
        if args.output:
            path=args.output.expanduser().resolve()
            path.parent.mkdir(parents=True,exist_ok=True)
            with path.open('x',encoding='utf8') as f:
                os.chmod(f.name,0o600);f.write(data+'\n')
        else: print(data)
    except (ValueError,KeyError,TypeError,OSError) as exc:
        print(json.dumps({'error':str(exc)},ensure_ascii=False),file=sys.stderr);return 2
    return 0

if __name__=='__main__': sys.exit(main())
