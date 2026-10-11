import importlib.util,tempfile,unittest,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('package_release',Path(__file__).resolve().parents[1]/'scripts/package-release.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ReleasePackageTests(unittest.TestCase):
 def allow(self,source,names):
  (source/'scripts').mkdir(exist_ok=True);(source/'scripts/release-source-files.json').write_text(json.dumps(names))
 def test_source_only_and_stale_checksum_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);source=root/'source';source.mkdir();(source/'core.js').write_text('// synthetic');(source/'README.md').write_text('Synthetic');(source/'data').mkdir();(source/'data/credentials.json').write_text('PRIVATE');(source/'SHA256SUMS').write_text('stale')
   self.allow(source,['core.js','README.md'])
   for name in ['auth.json','runtime-settings.json','private-project.json','private-notes.txt']:(source/name).write_text('PRIVATE')
   m.build(source,root/'out','fixture');stage=root/'out/fixture';self.assertFalse((stage/'data').exists());self.assertEqual(m.verify(stage),2);self.assertFalse(any((stage/name).exists() for name in ['auth.json','runtime-settings.json','private-project.json','private-notes.txt']))
   (stage/'SHA256SUMS').write_text('stale')
   with self.assertRaisesRegex(ValueError,'Stale checksum'):m.verify(stage)
 def test_changed_payload_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);source=root/'source';source.mkdir();(source/'core.js').write_text('// synthetic');self.allow(source,['core.js']);m.build(source,root/'out','fixture');stage=root/'out/fixture';(stage/'core.js').write_text('// changed')
   with self.assertRaisesRegex(ValueError,'manifest mismatch'):m.verify(stage)

 def test_allowlist_fails_closed(self):
  with tempfile.TemporaryDirectory() as tmp:
   source=Path(tmp)/'source';source.mkdir()
   for names in [['../private.json'],['missing.js'],['MANIFEST.json']]:
    self.allow(source,names)
    with self.assertRaises(ValueError):list(m.payload(source))
   with self.assertRaises(ValueError):
    self.allow(source,['link.js']);(source/'link.js').symlink_to('/tmp/no-private-file');list(m.payload(source))
