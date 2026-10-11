"""Build source-only ZIP/TAR with consistent checksums. Never packages runtime data."""
import argparse,hashlib,json,shutil,tarfile,zipfile
from pathlib import Path
CHECKSUMS={'MANIFEST.json','MANIFEST.sha256','SHA256SUMS'}
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def payload(source):
 # This reviewed list is authoritative. Dropped files are never discovered into a release.
 manifest=source/'scripts/release-source-files.json'
 names=json.loads(manifest.read_text())
 if not isinstance(names,list) or not names or len(names)!=len(set(names)):
  raise ValueError('Invalid reviewed source allowlist')
 for name in sorted(names):
  if not isinstance(name,str): raise ValueError('Invalid source path')
  relative=Path(name)
  if relative.is_absolute() or '..' in relative.parts or relative.as_posix()!=name or name in CHECKSUMS:
   raise ValueError('Unsafe source path: '+name)
  path=source/relative
  if any(part.is_symlink() for part in [path,*path.parents] if part!=source.parent):
   raise ValueError('Symlink source path: '+name)
  if not path.is_file(): raise ValueError('Missing reviewed source: '+name)
  yield relative

def verify(root):
 expected=json.loads((root/'MANIFEST.json').read_text())
 actual={p.relative_to(root).as_posix():digest(p) for p in root.rglob('*') if p.is_file() and p.name not in {'MANIFEST.json','MANIFEST.sha256','SHA256SUMS'}}
 if actual!=expected: raise ValueError('Payload manifest mismatch')
 correct=''.join(f'{sha}  {name}\n' for name,sha in sorted({**expected,'MANIFEST.json':digest(root/'MANIFEST.json')}.items()))
 for name in ['MANIFEST.sha256','SHA256SUMS']:
  if (root/name).read_text()!=correct: raise ValueError('Stale checksum set: '+name)
 return len(expected)

def build(source,out,label):
 source=source.resolve();out=out.resolve();out.mkdir(parents=True,exist_ok=True);stage=out/label
 if stage.exists(): raise ValueError('Refusing to replace an existing stage')
 stage.mkdir()
 for relative in payload(source):
  destination=stage/relative;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/relative,destination)
 manifest={p.relative_to(stage).as_posix():digest(p) for p in sorted(stage.rglob('*')) if p.is_file()}
 (stage/'MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
 sums=''.join(f'{sha}  {name}\n' for name,sha in sorted({**manifest,'MANIFEST.json':digest(stage/'MANIFEST.json')}.items()))
 for name in ['MANIFEST.sha256','SHA256SUMS']:(stage/name).write_text(sums)
 verify(stage)
 with zipfile.ZipFile(out/(label+'.zip'),'w',zipfile.ZIP_DEFLATED) as z:
  for p in sorted(stage.rglob('*')):
   if p.is_file():
    i=zipfile.ZipInfo(label+'/'+p.relative_to(stage).as_posix(),(2026,10,10,0,0,0));i.external_attr=0o100644<<16;i.compress_type=zipfile.ZIP_DEFLATED;z.writestr(i,p.read_bytes())
 with tarfile.open(out/(label+'.tar.gz'),'w:gz') as t:
  for p in sorted(stage.rglob('*')):
   if p.is_file():
    i=t.gettarinfo(str(p),arcname=label+'/'+p.relative_to(stage).as_posix());i.uid=i.gid=0;i.uname=i.gname='';i.mode=0o644;i.mtime=1791590400
    with p.open('rb') as f:t.addfile(i,f)
 return {name:digest(out/name) for name in [label+'.zip',label+'.tar.gz']}
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[1]);a.add_argument('--out',type=Path,required=True);a.add_argument('--label',default='orch3stra-2.3.0-mit-candidate');args=a.parse_args();print(json.dumps(build(args.source,args.out,args.label),indent=2))
