#!/usr/bin/env python3
"""Validate a Meta product CSV locally; never upload or execute cell content."""
import argparse
import csv
import hashlib
import io
import json
import re
from collections import Counter
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

REQUIRED = ['id', 'title', 'description', 'availability', 'condition', 'link', 'image_link', 'brand', 'price']
LIMITS = {'id': 100, 'title': 200, 'description': 9999, 'brand': 100}


def inspect(path):
    raw = path.read_bytes()
    report = {'source_path': str(path.resolve()), 'source_sha256': hashlib.sha256(raw).hexdigest(),
              'source_bytes': len(raw), 'errors': [], 'warnings': []}
    try:
        table = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'), newline=''), strict=True))
    except (UnicodeDecodeError, csv.Error) as exc:
        report['errors'].append({'type': 'CSV_PARSE', 'message': str(exc)})
        return report, [], []
    first = 0
    if len(table) > 1 and table[0] and all(x.lstrip().startswith(('# Required', '# Optional')) for x in table[0]):
        first = 1
        report['warnings'].append('Template instruction row omitted from prepared upload copy.')
    if len(table) <= first:
        report['errors'].append({'type': 'EMPTY_FILE'})
        return report, [], []
    headers = table[first]
    duplicates = [k for k, n in Counter(headers).items() if n > 1]
    if duplicates:
        report['errors'].append({'type': 'DUPLICATE_COLUMNS', 'columns': duplicates})
    missing = [k for k in REQUIRED if k not in headers]
    if missing:
        report['errors'].append({'type': 'MISSING_COLUMNS', 'columns': missing})
    rows, ids, currencies = [], [], set()
    empty_rows = 0
    for line, values in enumerate(table[first + 1:], first + 2):
        if not values or not any(x.strip() for x in values):
            empty_rows += 1
            continue
        if len(values) != len(headers):
            report['errors'].append({'type': 'ROW_WIDTH', 'row': line, 'expected': len(headers), 'actual': len(values)})
            continue
        row = dict(zip(headers, values))
        rows.append(row)
        for name in REQUIRED:
            if name in row and not row[name].strip():
                report['errors'].append({'type': 'EMPTY_REQUIRED', 'row': line, 'field': name})
        for name, limit in LIMITS.items():
            if len(row.get(name, '')) > limit:
                report['errors'].append({'type': 'TOO_LONG', 'row': line, 'field': name, 'limit': limit})
        ident = row.get('id', '')
        if ident:
            ids.append(ident)
            if ident != ident.strip():
                report['errors'].append({'type': 'ID_WHITESPACE', 'row': line})
        for name in ('link', 'image_link'):
            value = row.get(name, '')
            if value:
                try:
                    url = urlsplit(value)
                    valid = url.scheme in ('http', 'https') and bool(url.hostname) and not any(c.isspace() for c in value)
                except ValueError:
                    valid = False
                if not valid:
                    report['errors'].append({'type': 'INVALID_URL', 'row': line, 'field': name})
        price = row.get('price', '')
        if price:
            match = re.fullmatch(r'(\d+(?:\.\d+)?) ([A-Z]{3})', price)
            if not match or Decimal(match[1]) < 0:
                report['errors'].append({'type': 'PRICE_FORMAT', 'row': line, 'example': '19.99 USD'})
            else:
                currencies.add(match[2])
    for ident, count in Counter(ids).items():
        if count > 1:
            report['errors'].append({'type': 'DUPLICATE_ID', 'id': ident, 'count': count})
    if not rows:
        report['errors'].append({'type': 'NO_PRODUCTS'})
    if empty_rows:
        report['warnings'].append(f'{empty_rows} empty rows omitted from prepared upload copy.')
    def placeholder(value):
        try:
            return urlsplit(value).hostname in ('example.com', 'www.example.com')
        except ValueError:
            return False
    if not missing and any(placeholder(r.get('link', '')) for r in rows):
        report['warnings'].append('Product links include example.com placeholders; treat as test data.')
    report.update(row_count=len(rows), columns=headers, ids=ids, currencies=sorted(currencies),
                  default_currency=next(iter(currencies)) if len(currencies) == 1 else None,
                  header_record=first + 1, image_validation='URL syntax only; remote size and ingestion are not checked locally.')
    return report, headers, rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path)
    parser.add_argument('--out-dir', required=True, type=Path)
    args = parser.parse_args()
    report, headers, rows = inspect(args.csv)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest = args.out_dir.resolve() / 'manifest.json'
    if not report['errors']:
        prepared = args.out_dir.resolve() / 'prepared.csv'
        with prepared.open('w', encoding='utf-8-sig', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)
        report.update(upload_path=str(prepared), upload_filename=args.csv.name,
                      upload_sha256=hashlib.sha256(prepared.read_bytes()).hexdigest(), upload_bytes=prepared.stat().st_size)
    manifest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: report.get(k) for k in ('row_count', 'columns', 'currencies', 'errors', 'warnings')} | {'manifest': str(manifest)}, ensure_ascii=False))
    raise SystemExit(2 if report['errors'] else 0)


if __name__ == '__main__':
    main()
