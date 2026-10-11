#!/usr/bin/env python3
"""Local stereo sound sampling. JSON stdin; bounded JSON-lines stdout.
No transcription, no model downloads, no GPU. Paths are supplied by Node, never clients.
"""
from __future__ import annotations
import array
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import wave
from voice_worker import youtube_url

MAX_SECONDS = 3600
MAX_BYTES = 512 * 1024**2
RATE = 48000

def emit(**v):
    print(json.dumps(v, ensure_ascii=False), flush=True)

def finite(v, lo, hi, label):
    x = float(v)
    if not math.isfinite(x) or not lo <= x <= hi:
        raise ValueError('Invalid '+label)
    return x

def ffmpeg(args):
    r = subprocess.run([os.environ.get('FFMPEG_BIN', os.environ.get('H3_FFMPEG', 'ffmpeg')),
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', '-y'] + args,
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=900)
    if r.returncode:
        raise ValueError('Audio processing failed: '+r.stderr.decode(errors='replace')[-1800:])

def options(raw):
    return dict(thresholdDb=finite(raw.get('thresholdDb', -42), -80, -10, 'silence threshold'),
        minGap=finite(raw.get('minGap', .45), .1, 5, 'minimum quiet gap'),
        minLength=finite(raw.get('minLength', .25), .08, 10, 'minimum sample duration'),
        padding=finite(raw.get('padding', .12), 0, 1, 'sample handles'),
        method=raw.get('method', 'auto') if raw.get('method', 'auto') in ('auto', 'silence', 'chapters', 'whole') else 'auto')

def analyze(path, raw, chapters=None):
    opts = options(raw)
    with wave.open(str(path), 'rb') as f:
        if f.getsampwidth()!=2 or f.getnchannels()!=2 or f.getframerate()!=RATE:
            raise ValueError('Sound library expects stereo 48 kHz 16-bit PCM.')
        count = f.getnframes()
        if count < RATE*.08 or count > RATE*(MAX_SECONDS+.02):
            raise ValueError('Source must contain 0.08–3600 seconds of audio.')
        duration=count/RATE
        stride=960  # 20ms; separate channels prevent phase-cancelled silence detection.
        envelope=[]; levels=[]; peaks=[]
        for i in range(0,count,stride):
            pcm=array.array('h', f.readframes(min(stride,count-i)))
            if sys.byteorder!='little': pcm.byteswap()
            n=len(pcm)//2
            power=max(sum(x*x for x in pcm[::2])/max(1,n),sum(x*x for x in pcm[1::2])/max(1,n))
            rms=math.sqrt(power)/32768
            levels.append(20*math.log10(max(rms,1e-9)))
            peaks.append(max((abs(x) for x in pcm), default=0)/32768)
            if i%(RATE*30)==0:
                emit(phase='analyzing',message='Finding quiet gaps and building waveform',progress=round(i/count,4))
    group=max(1,math.ceil(len(peaks)/1400))
    envelope=[round(max(peaks[i:i+group]),4) for i in range(0,len(peaks),group)]
    gaps=[]; begin=None
    for i,v in enumerate(levels+[0]):
        t=min(duration,i*.02)
        if v<opts['thresholdDb'] and i<len(levels):
            if begin is None: begin=t
        elif begin is not None:
            if t-begin>=opts['minGap']: gaps.append((begin,t))
            begin=None
    chapter_rows=[]
    for c in (chapters or [])[:1000]:
        try:
            a=max(0,float(c['start_time'])); b=min(duration,float(c['end_time']))
            if math.isfinite(a) and math.isfinite(b) and b>a:
                chapter_rows.append(dict(start=a,end=b,name=str(c.get('title') or 'Chapter')[:180],basis='chapter'))
        except (ValueError,KeyError,TypeError): pass
    chapter_rows.sort(key=lambda c:c['start'])
    method=opts['method']
    if method=='auto': method='chapters' if len(chapter_rows)>=2 else 'silence'
    warnings=[]; rows=[]
    if method=='chapters' and not chapter_rows:
        warnings.append('This source has no usable chapter metadata. Quiet-gap detection was used instead.')
        method='silence'
    if method=='chapters': rows=chapter_rows
    elif method=='whole': rows=[dict(start=0,end=duration,name='Full recording',basis='whole')]
    else:
        at=0
        for a,b in gaps+[(duration,duration)]:
            if a-at>=opts['minLength']:
                left=max(0,at-opts['padding']); right=min(duration,a+opts['padding'])
                if rows: left=max(left,rows[-1]['end'])
                rows.append(dict(start=left,end=right,name='Sample '+str(len(rows)+1),basis='quiet-gap'))
            at=b
        if len(rows)<=1:
            warnings.append('No clear sequence of separate samples was found. Continuous music, overlapping sounds, or background noise may need manual splits. No stems or instrument separation were performed.')
        if not rows:
            warnings.append('Nothing exceeded the selected threshold for long enough. Lower the threshold or keep the whole recording.')
    if len(rows)>500:
        raise ValueError('More than 500 candidates detected. Increase the minimum gap/duration or analyze a shorter recording.')
    for i,r in enumerate(rows):
        r.update(id='sample-'+str(i+1),start=round(r['start'],5),end=round(r['end'],5),keep=True,category='unclassified')
    return dict(duration=duration,sampleRate=RATE,channels=2,peaks=envelope,gaps=[list(g) for g in gaps[:2000]],
        samples=rows,options=opts,method=method,warnings=warnings)

def download(req,directory):
    if req.get('rightsConfirmed') is not True:
        raise ValueError('Confirm permission to download and use this source.')
    url=youtube_url(req['url'])
    try: import yt_dlp
    except ImportError as exc: raise ValueError('yt-dlp is missing in the selected Python environment. Install yt-dlp there or upload a local audio file.') from exc
    class Quiet:
        def debug(self,*a): pass
        def warning(self,*a): pass
        def error(self,*a): pass
    def progress(d):
        if d.get('status')=='downloading':
            n=d.get('downloaded_bytes',0); total=d.get('total_bytes') or d.get('total_bytes_estimate')
            if n>MAX_BYTES: raise ValueError('Download exceeds the 512 MiB sound-source limit.')
            emit(phase='downloading',message='Downloading original audio',progress=min(1,n/total) if total else None)
    def match(info,*,incomplete=False):
        if info.get('is_live') or info.get('live_status') in ('is_live','is_upcoming'): return 'Live/upcoming sources are not supported.'
        if (info.get('age_limit') or 0)>0 or info.get('availability') in ('private','subscriber_only','premium_only','needs_auth'): return 'This importer supports public, unrestricted sources only.'
        if info.get('duration') and info['duration']>MAX_SECONDS: return 'Source exceeds one hour. Upload a shorter local excerpt.'
    opts={'format':'bestaudio/best','outtmpl':str(directory/'download.%(ext)s'),'noplaylist':True,
        'quiet':True,'no_warnings':True,'logger':Quiet(),'socket_timeout':20,'retries':1,'fragment_retries':1,
        'extractor_retries':1,'max_filesize':MAX_BYTES,'cachedir':False,'overwrites':False,
        'match_filter':match,'progress_hooks':[progress],
        'js_runtimes':{'node':{'path':os.environ.get('H3_NODE','node')}}}
    emit(phase='downloading',message='Looking up public YouTube audio…')
    with yt_dlp.YoutubeDL(opts) as ydl: info=ydl.extract_info(url,download=True)
    if not isinstance(info,dict) or info.get('_type') in ('playlist','multi_video'): raise ValueError('Expected one public video, not a playlist.')
    found=[p for p in directory.glob('download.*') if p.suffix not in ('.part','.ytdl','.json')]
    if len(found)!=1 or found[0].stat().st_size>MAX_BYTES: raise ValueError('Download did not produce one supported bounded audio file. Use a local file; no access restriction was bypassed.')
    return found[0],dict(kind='youtube',url=url,name=str(info.get('title') or 'YouTube audio')[:220],
        uploader=info.get('uploader'),license=info.get('license'),chapters=info.get('chapters') or [])

def main(req):
    dest=Path(req['output']); action=req.get('action','import')
    if action=='analyze': return analyze(req['input'],req.get('options',{}),req.get('chapters'))
    if action=='extract':
        start=finite(req['start'],0,MAX_SECONDS,'sample In'); end=finite(req['end'],start+.08,MAX_SECONDS,'sample Out')
        with wave.open(req['input'],'rb') as src:
            n=src.getnframes(); rate=src.getframerate(); a=round(start*rate); b=round(end*rate)
            if b>n or a>=b: raise ValueError('Sample extends past the source. Adjust its In/Out values.')
            src.setpos(a)
            with wave.open(str(dest),'wb') as out:
                out.setparams(src.getparams())
                for i in range(a,b,rate): out.writeframes(src.readframes(min(rate,b-i)))
        return dict(duration=(b-a)/rate,sampleRate=rate,channels=2)
    src=req.get('input'); provenance={'kind':'upload','name':str(req.get('name') or 'Local audio')[:220]}
    if req.get('url'): src,provenance=download(req,dest.parent)
    if not src: raise ValueError('No source provided.')
    if Path(src).stat().st_size>MAX_BYTES: raise ValueError('Sound source exceeds 512 MiB.')
    with open(src,'rb') as f: head=f.read(4096).lstrip()
    if head.startswith((b'#EXTM3U',b'[playlist]',b'<?xml',b'<html',b'<!DOCTYPE')): raise ValueError('Playlists, network manifests and HTML are not audio sources.')
    emit(phase='decoding',message='Preparing stereo 48 kHz editing source…')
    ffmpeg(['-protocol_whitelist','file,pipe','-format_whitelist','wav,mp3,mov,matroska,webm,ogg,flac,aac,avi','-i',str(src),'-t',str(MAX_SECONDS+1),'-map','0:a:0','-vn',
        '-ac','2','-ar',str(RATE),'-c:a','pcm_s16le',str(dest)])
    return {**analyze(dest,req.get('options',{}),provenance.get('chapters')), 'provenance':provenance}

if __name__=='__main__':
    try:
        req=json.load(sys.stdin); emit(result=main(req))
    except Exception as exc:
        emit(error=str(exc)[:3000]); sys.exit(1)
