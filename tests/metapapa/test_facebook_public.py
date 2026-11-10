import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'metapapa/scripts/facebook_id_public.py'
spec = importlib.util.spec_from_file_location('facebook_public', SCRIPT)
public = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public)


def html(url='https://www.facebook.com/example.page/', ident='123', ios=True):
    tags = f'<meta property="og:url" content="{url}"><meta property="al:android:url" content="fb://profile/{ident}">'
    if ios:
        tags += f'<meta property="al:ios:url" content="fb://profile/{ident}">'
    return '<html><head>' + tags + '</head><body></body></html>'


class PublicFacebookTests(unittest.TestCase):
    def setUp(self):
        self.target = public.normalize_profile_url('https://www.facebook.com/example.page')

    def test_normalize(self):
        self.assertEqual(public.normalize_profile_url('http://m.facebook.com/Example.Page/?ref=x#test'), self.target)
        self.assertEqual(public.normalize_profile_url('https://facebook.com/profile.php?id=123&ref=x')['key'], '123')

    def test_reject_non_profile_destinations(self):
        for value in ('https://facebook.com.evil.test/example', 'https://a:b@facebook.com/example',
                      'https://facebook.com:443/example', 'file:///example', 'https://facebook.com/logout.php',
                      'https://facebook.com/groups/123', 'https://facebook.com/login',
                      'https://facebook.com/profile.php?id=1&id=2', 'https://facebook.com/a\\b',
                      'https://facebook.com/000', 'https://facebook.com/a%2fb', 'https://facebook.com/../test',
                      'https://facebook.com/example\n', 'https://facebook.com/a..b'):
            with self.subTest(value=value), self.assertRaisesRegex(public.LookupFailure, 'INVALID_PROFILE_URL'):
                public.normalize_profile_url(value)

    def test_metadata_ignores_other_ids_and_inert_markup(self):
        extra = '''<script type="application/json">{"viewerID":"999","id":"777","url":"fb://profile/888"}</script>
        <template><meta property="al:ios:url" content="fb://profile/888"></template>'''
        document = html().replace('</head>', extra + '</head>').replace('</body>', '<meta property="al:ios:url" content="fb://profile/777"></body>')
        result = public.parse_profile_html(document, self.target)
        self.assertEqual(result['profile_id'], '123')
        self.assertEqual(result['username'], 'example.page')

    def test_single_platform_and_repeated_equal_tags(self):
        document = html(ios=False).replace('</head>', '<meta property="og:url" content="https://www.facebook.com/example.page?ref=test"></head>')
        result = public.parse_profile_html(document, self.target)
        self.assertEqual(result['profile_id'], '123')
        self.assertEqual(result['evidence_fields'], ['og:url', 'al:android:url'])

    def test_conflicting_metadata(self):
        documents = [html().replace('al:ios:url" content="fb://profile/123', 'al:ios:url" content="fb://profile/456'),
                     html().replace('</head>', '<meta property="og:url" content="https://facebook.com/other"></head>'),
                     html().replace('property="og:url"', 'property="og:url" property="al:ios:url"')]
        for document in documents:
            with self.subTest(document=document), self.assertRaisesRegex(public.LookupFailure, 'AMBIGUOUS_PROFILE_METADATA'):
                public.parse_profile_html(document, self.target)

    def test_mismatched_target(self):
        for url in ('https://facebook.com/other', 'https://outside.test/example.page', 'https://facebook.com/profile.php?id=123'):
            with self.subTest(url=url), self.assertRaisesRegex(public.LookupFailure, 'PROFILE_TARGET_MISMATCH'):
                public.parse_profile_html(html(url), self.target)

    def test_missing_or_non_profile_metadata(self):
        for document in ('<html><head></head><body>id 123</body></html>',
                         html().replace('fb://profile/', 'fb://photo/'),
                         '<html><head><meta property="og:url" content="https://facebook.com/example.page"></head></html>'):
            with self.subTest(document=document), self.assertRaisesRegex(public.LookupFailure, 'PUBLIC_PROFILE_METADATA_UNAVAILABLE'):
                public.parse_profile_html(document, self.target)

    def test_numeric_identity_requires_match(self):
        target = public.normalize_profile_url('https://facebook.com/profile.php?id=123')
        self.assertEqual(public.parse_profile_html(html(), target)['profile_id'], '123')
        with self.assertRaisesRegex(public.LookupFailure, 'PROFILE_TARGET_MISMATCH'):
            public.parse_profile_html(html(ident='456'), target)
        with self.assertRaisesRegex(public.LookupFailure, 'PROFILE_TARGET_MISMATCH'):
            public.parse_profile_html(html(url='https://facebook.com/456'), target)

    def test_resolve_one_get_minimal_output(self):
        calls = []
        def fetch(url, timeout):
            calls.append((url, timeout))
            return {'http_status': 200, 'content_type': 'text/html; charset=utf-8', 'body': html().encode()}
        result = public.resolve('https://facebook.com/example.page?tracking=x', fetcher=fetch)
        self.assertEqual(calls, [(self.target['url'], 15)])
        self.assertEqual(result['profile_id'], '123')
        self.assertFalse(result['authenticated'])
        self.assertEqual(result['request_count'], 1)
        self.assertTrue({'body', 'html', 'cookie', 'actor_id'}.isdisjoint(result))

    def test_invalid_input_sends_nothing(self):
        def fetch(*args):
            self.fail('No request expected')
        with self.assertRaisesRegex(public.LookupFailure, 'INVALID_PROFILE_URL'):
            public.resolve('https://outside.test/profile', fetcher=fetch)
        for value in (0, 31, True, 1.5):
            with self.subTest(value=value), self.assertRaisesRegex(public.LookupFailure, 'INVALID_TIMEOUT'):
                public.resolve(self.target['url'], value, fetcher=fetch)

    def test_http_failure_never_retries_or_returns_an_id(self):
        cases = [(429, 'text/html', 'RATE_LIMITED'), (403, 'text/html', 'PUBLIC_ACCESS_DENIED'),
                 (302, 'text/html', 'PUBLIC_REDIRECT_REQUIRES_BROWSER'), (404, 'text/html', 'PUBLIC_HTTP_ERROR'),
                 (200, 'application/json', 'PROFILE_RESPONSE_NOT_HTML')]
        for status, content_type, code in cases:
            calls = []
            def fetch(*args):
                calls.append(args)
                return {'http_status': status, 'content_type': content_type, 'body': html().encode()}
            with self.subTest(status=status, content_type=content_type), self.assertRaisesRegex(public.LookupFailure, code):
                public.resolve(self.target['url'], fetcher=fetch)
            self.assertEqual(len(calls), 1)

    def fake_curl(self, root, body, exit_code=0):
        binary = root / 'curl'
        capture = root / 'args.json'
        binary.write_text(f'#!{sys.executable}\nimport json,sys\nfrom pathlib import Path\nPath({str(capture)!r}).write_text(json.dumps(sys.argv[1:]))\nsys.stdout.buffer.write({body!r})\nsys.stderr.write("\\nMETAPAPA_HTTP:200\\nMETAPAPA_TYPE:text/html; charset=utf-8\\n")\nsys.exit({exit_code})\n')
        binary.chmod(0o700)
        return capture

    def test_curl_transport_disables_auth_config_and_redirects(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            capture = self.fake_curl(root, html().encode())
            with patch.dict(os.environ, {'PATH': str(root) + os.pathsep + os.defpath}):
                result = public.resolve(self.target['url'])
            self.assertEqual(result['profile_id'], '123')
            args = json.loads(capture.read_text())
            self.assertEqual(args[0], '-q')
            self.assertIn('--no-netrc', args)
            self.assertTrue({'-L', '--location', '--cookie', '-b', '--cookie-jar', '--user', '--netrc'}.isdisjoint(args))
            self.assertEqual(args[-2:], ['--url', self.target['url']])

    def test_curl_timeout_network_and_decompressed_size_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.dict(os.environ, {'PATH': str(root) + os.pathsep + os.defpath}):
                for code, expected in ((28, 'PUBLIC_GET_TIMEOUT'), (63, 'PROFILE_RESPONSE_TOO_LARGE'), (6, 'PUBLIC_GET_UNAVAILABLE')):
                    self.fake_curl(root, b'', code)
                    with self.subTest(code=code), self.assertRaisesRegex(public.LookupFailure, expected):
                        public.curl_get(self.target['url'], 1)
                self.fake_curl(root, b'x' * 200)
                with patch.object(public, 'MAX_BYTES', 100), self.assertRaisesRegex(public.LookupFailure, 'PROFILE_RESPONSE_TOO_LARGE'):
                    public.curl_get(self.target['url'], 1)


if __name__ == '__main__':
    unittest.main()
