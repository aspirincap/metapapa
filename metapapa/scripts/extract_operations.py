#!/usr/bin/env python3
"""Extract operation names/doc IDs only; never copy credentials or request bodies."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

NAMES = {
    'CatalogDataSourceSelectorV2Query': 'listFeeds',
    'useCatalogFeedPreviewQuery': 'preview',
    'useCreatePrimaryProductFeedMutation': 'createFeed',
    'useCreateProductFeedUploadSessionMutation': 'createUpload',
    'CatalogDataSourcesUnifiedDetailsPageQuery': 'feedDetails',
}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('har', type=Path)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    found = {}
    entries = json.loads(a.har.read_text(encoding='utf-8-sig'))['log']['entries']
    for entry in entries:
        req = entry['request']
        url = urlsplit(req['url'])
        if url.scheme != 'https' or url.netloc != 'business.facebook.com' or url.path != '/api/graphql/':
            continue
        form = parse_qs(req.get('postData', {}).get('text', ''))
        name = form.get('fb_api_req_friendly_name', [''])[0]
        doc = form.get('doc_id', [''])[0]
        if name in NAMES and doc.isdigit():
            found[NAMES[name]] = {'friendly_name': name, 'doc_id': doc}
    result = {'observed_on': datetime.now(timezone.utc).date().isoformat(),
              'origin': 'https://business.facebook.com', 'upload_path': '/product_feeds/upload/',
              'graphql_path': '/api/graphql/', 'operations': found}
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(a.out.resolve()), 'operations': sorted(found),
                      'missing': sorted(set(NAMES.values()) - set(found))}))


if __name__ == '__main__':
    main()
