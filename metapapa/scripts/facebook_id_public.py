#!/usr/bin/env python3
"""Resolve a public Facebook profile URL using one anonymous curl GET. JSON output."""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit

ORIGIN = 'https://www.facebook.com'
MAX_BYTES = 12 * 1024 * 1024
RESERVED = set('me home login logout checkpoint recover settings privacy help policies dialog ajax api photo photos video videos watch reel reels stories posts groups events marketplace gaming friends messages notifications search share sharer pages people business ads adsmanager'.split())


class LookupFailure(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def normalize_profile_url(value):
    def fail():
        raise LookupFailure('INVALID_PROFILE_URL')
    if not isinstance(value, str) or len(value) > 4096 or re.search(r'[\\\s\x00-\x1f\x7f]', value):
        fail()
    try:
        url = urlsplit(value)
        if url.scheme not in ('http', 'https') or url.netloc.lower() not in ('facebook.com', 'www.facebook.com', 'm.facebook.com'):
            fail()
    except ValueError:
        fail()
    if url.path == '/profile.php':
        ids = parse_qs(url.query, keep_blank_values=True).get('id', [])
        if len(ids) != 1 or not re.fullmatch(r'[1-9][0-9]{0,29}', ids[0]):
            fail()
        return {'url': ORIGIN + '/profile.php?id=' + ids[0], 'kind': 'numeric', 'key': ids[0]}
    match = re.fullmatch(r'/([A-Za-z0-9.]{1,100})/?', url.path)
    if not match:
        fail()
    key = match[1].lower()
    if key.startswith('.') or key.endswith('.') or '..' in key or key.endswith('.php') or key in RESERVED:
        fail()
    if key.isdigit() and not re.fullmatch(r'[1-9][0-9]{0,29}', key):
        fail()
    return {'url': ORIGIN + '/' + key, 'kind': 'numeric' if key.isdigit() else 'vanity', 'key': key}


class ProfileMetadata(HTMLParser):
    """Only head metadata, excluding script text, templates, and body content."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_head = False
        self.in_template = 0
        self.values = {}

    def handle_starttag(self, tag, attrs):
        if tag == 'head':
            self.in_head = True
        elif tag == 'body':
            self.in_head = False
        elif tag == 'template':
            self.in_template += 1
        elif tag == 'meta' and self.in_head and not self.in_template:
            keys = [key for key, _ in attrs]
            if len(set(keys)) != len(keys):
                raise LookupFailure('AMBIGUOUS_PROFILE_METADATA')
            fields = dict(attrs)
            key = (fields.get('property') or '').lower()
            if key in ('og:url', 'al:android:url', 'al:ios:url'):
                self.values.setdefault(key, []).append(fields.get('content') or '')

    def handle_endtag(self, tag):
        if tag == 'head':
            self.in_head = False
        elif tag == 'template':
            self.in_template = max(0, self.in_template - 1)


def parse_profile_html(html, target):
    parser = ProfileMetadata()
    parser.feed(html)
    canonicals = parser.values.get('og:url', [])
    if not canonicals:
        raise LookupFailure('PUBLIC_PROFILE_METADATA_UNAVAILABLE')
    try:
        normalized = [normalize_profile_url(value) for value in canonicals]
    except LookupFailure:
        raise LookupFailure('PROFILE_TARGET_MISMATCH') from None
    identities = {(item['kind'], item['key']) for item in normalized}
    if len(identities) != 1:
        raise LookupFailure('AMBIGUOUS_PROFILE_METADATA')
    canonical = normalized[0]
    ids = []
    evidence = ['og:url']
    for key in ('al:android:url', 'al:ios:url'):
        for value in parser.values.get(key, []):
            match = re.fullmatch(r'fb://profile/([1-9][0-9]{0,29})', value)
            if not match:
                raise LookupFailure('PUBLIC_PROFILE_METADATA_UNAVAILABLE')
            ids.append(match[1])
        if key in parser.values:
            evidence.append(key)
    if not ids:
        raise LookupFailure('PUBLIC_PROFILE_METADATA_UNAVAILABLE')
    if len(set(ids)) != 1:
        raise LookupFailure('AMBIGUOUS_PROFILE_METADATA')
    profile_id = ids[0]
    if target['kind'] == 'vanity' and (canonical['kind'], canonical['key']) != ('vanity', target['key']):
        raise LookupFailure('PROFILE_TARGET_MISMATCH')
    if target['kind'] == 'numeric' and profile_id != target['key']:
        raise LookupFailure('PROFILE_TARGET_MISMATCH')
    if canonical['kind'] == 'numeric' and canonical['key'] != profile_id:
        raise LookupFailure('PROFILE_TARGET_MISMATCH')
    return {'profile_id': profile_id, 'id_type': 'profile_id',
            'username': canonical['key'] if canonical['kind'] == 'vanity' else None,
            'profile_url': canonical['url'], 'evidence_fields': evidence}


def curl_get(url, timeout_seconds):
    # -q must be first: ignore .curlrc. No cookies, netrc, authentication, redirects,
    # shell interpolation, or browser state. Decompressed bytes are bounded as read.
    command = ['curl', '-q', '--silent', '--show-error', '--no-netrc',
               '--proto', '=https', '--connect-timeout', str(min(10, timeout_seconds)),
               '--max-time', str(timeout_seconds), '--compressed',
               '--max-filesize', str(MAX_BYTES), '--header', 'Accept: text/html',
               '--user-agent', 'Mozilla/5.0', '--write-out',
               '%{stderr}\nMETAPAPA_HTTP:%{http_code}\nMETAPAPA_TYPE:%{content_type}\n',
               '--url', url]
    with tempfile.TemporaryFile() as diagnostics:
        try:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=diagnostics)
        except FileNotFoundError:
            raise LookupFailure('CURL_UNAVAILABLE') from None
        expired = threading.Event()
        def expire():
            expired.set()
            try:
                process.kill()
            except ProcessLookupError:
                pass
        timer = threading.Timer(timeout_seconds + 2, expire)
        timer.daemon = True
        timer.start()
        body = bytearray()
        try:
            while True:
                chunk = process.stdout.read(65536)
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    raise LookupFailure('PROFILE_RESPONSE_TOO_LARGE')
            result_code = process.wait()
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()
        if expired.is_set() or result_code == 28:
            raise LookupFailure('PUBLIC_GET_TIMEOUT')
        if result_code == 63:
            raise LookupFailure('PROFILE_RESPONSE_TOO_LARGE')
        if result_code != 0:
            raise LookupFailure('PUBLIC_GET_UNAVAILABLE')
        diagnostics.seek(0)
        metadata = diagnostics.read(4096).decode('utf-8', errors='replace')
    status = re.search(r'^METAPAPA_HTTP:([0-9]{3})$', metadata, re.M)
    content_type = re.search(r'^METAPAPA_TYPE:([^\r\n]*)$', metadata, re.M)
    if not status or not content_type:
        raise LookupFailure('PUBLIC_RESPONSE_UNCONFIRMED')
    return {'http_status': int(status[1]), 'content_type': content_type[1], 'body': bytes(body)}


def resolve(url, timeout_seconds=15, *, fetcher=curl_get):
    target = normalize_profile_url(url)
    if type(timeout_seconds) is not int or not 1 <= timeout_seconds <= 30:
        raise LookupFailure('INVALID_TIMEOUT')
    start = time.monotonic()
    response = fetcher(target['url'], timeout_seconds)
    status = response['http_status']
    if status == 429:
        raise LookupFailure('RATE_LIMITED')
    if status in (401, 403):
        raise LookupFailure('PUBLIC_ACCESS_DENIED')
    if 300 <= status <= 399:
        raise LookupFailure('PUBLIC_REDIRECT_REQUIRES_BROWSER')
    if status != 200:
        raise LookupFailure('PUBLIC_HTTP_ERROR')
    if response['content_type'].split(';')[0].strip().lower() != 'text/html':
        raise LookupFailure('PROFILE_RESPONSE_NOT_HTML')
    if len(response['body']) > MAX_BYTES:
        raise LookupFailure('PROFILE_RESPONSE_TOO_LARGE')
    data = parse_profile_html(response['body'].decode('utf-8', errors='replace'), target)
    return {'operation': 'facebook.profileId.resolve', 'status': 'resolved', **data,
            'request_url': target['url'], 'method': 'facebook_public_get_metadata',
            'authenticated': False, 'request_count': 1, 'http_status': status,
            'elapsed_ms': round((time.monotonic() - start) * 1000),
            'fetched_at': datetime.now(timezone.utc).isoformat()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', help='Public Facebook profile homepage URL')
    parser.add_argument('--timeout-seconds', type=int, default=15)
    args = parser.parse_args()
    try:
        result = resolve(args.url, args.timeout_seconds)
    except LookupFailure as error:
        invalid = error.code in ('INVALID_PROFILE_URL', 'INVALID_TIMEOUT')
        result = {'operation': 'facebook.profileId.resolve',
                  'status': 'invalid_input' if invalid else 'unresolved', 'code': error.code,
                  'authenticated': False, 'profile_id': None,
                  'next': 'correct_input' if invalid else 'stop_rate_limit' if error.code == 'RATE_LIMITED' else 'chrome_onboarding_then_official_lookup'}
        print(json.dumps(result, ensure_ascii=False))
        return 2
    except OSError:
        print(json.dumps({'status': 'unresolved', 'code': 'LOCAL_IO_UNAVAILABLE', 'profile_id': None}))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
