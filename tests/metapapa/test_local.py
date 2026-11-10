import csv, importlib.util, io, json, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'metapapa/scripts'
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/(name+'.py')); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
csv_tool=load('prepare_csv'); box=load('toolbox'); comments=load('comments')
class CSVTests(unittest.TestCase):
    def inspect(self,rows,headers=None):
        folder=Path(tempfile.mkdtemp()); path=folder/'products.csv'
        with path.open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.writer(f);writer.writerow(headers or csv_tool.REQUIRED);writer.writerows(rows)
        return csv_tool.inspect(path)
    def row(self,ident='000012345678901234567890',price='19.99 USD'):
        return [ident,'标题','Description, with comma\nand newline','in stock','new','https://shop.test/item','https://shop.test/a.png','Brand',price]
    def test_ids_extras_bom_newlines_preserved(self):
        report,headers,rows=self.inspect([self.row()+['blue']],csv_tool.REQUIRED+['color']);self.assertEqual(report['errors'],[]);self.assertEqual(rows[0]['id'],'000012345678901234567890');self.assertEqual(rows[0]['color'],'blue');self.assertIn('\n',rows[0]['description'])
    def test_duplicate_id(self):
        report,_,_=self.inspect([self.row(),self.row()]);self.assertIn('DUPLICATE_ID',[e['type'] for e in report['errors']])
    def test_empty_products(self):
        report,_,_=self.inspect([]);self.assertIn('NO_PRODUCTS',[e['type'] for e in report['errors']])
    def test_width_and_price(self):
        report,_,_=self.inspect([self.row()[:-1],self.row('1','19.99 usd')]);self.assertEqual({e['type'] for e in report['errors']},{'ROW_WIDTH','PRICE_FORMAT'})
    def test_mixed_currency_requires_explicit_feed_default(self):
        report,_,_=self.inspect([self.row('1','19.99 USD'),self.row('2','10 EUR')]);self.assertIsNone(report['default_currency']);self.assertEqual(report['currencies'],['EUR','USD'])
    def test_url_and_headers(self):
        row=self.row();row[5]='javascript:alert(1)';report,_,_=self.inspect([row]);self.assertIn('INVALID_URL',[e['type'] for e in report['errors']])
class ToolboxTests(unittest.TestCase):
    def test_totp_rfc_vector(self):
        self.assertEqual(box.totp({'secret':'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ','time':59,'digits':8})['code'],'94287082')
    def test_dst_gap_and_overlap(self):
        with self.assertRaisesRegex(ValueError,'NONEXISTENT'):box.timezone({'datetime':'2026-03-08T02:30:00','from_zone':'America/New_York','to_zone':'UTC'})
        with self.assertRaisesRegex(ValueError,'AMBIGUOUS'):box.timezone({'datetime':'2026-11-01T01:30:00','from_zone':'America/New_York','to_zone':'UTC'})
    def test_timezone_conversion(self):
        self.assertEqual(box.timezone({'datetime':'2026-11-10T12:00:00','from_zone':'Asia/Shanghai','to_zone':'UTC'})['target'],'2026-11-10T04:00:00+00:00')
    def test_comment_preview_and_exclusions(self):
        r=comments.comment_preview({'keywords':['spam'],'comments':[{'id':'1','message':'SPAM','from':{'id':'2'}}],'exclude_author_ids':['2']});self.assertEqual(r['count'],0);self.assertFalse(r['executed'])
    def test_url_id_does_not_call_vendor(self):
        self.assertEqual(box.facebook_id({'value':'https://www.facebook.com/profile.php?id=123'})['ids'],['123']);self.assertEqual(box.facebook_id({'value':'https://www.facebook.com/page-name'})['ids'],[])
if __name__=='__main__':unittest.main()
