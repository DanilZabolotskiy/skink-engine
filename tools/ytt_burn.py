"""Subtitles .ytt (srv3) into a picture — the way the YouTube player on a computer draws them (full screen, controls hidden).

python tools/ytt_burn.py --ytt <file.ytt> --video <in.mp4> [--out <out.mp4>] [--from 0] [--to 38]
    [--frames 9.5,20,31 --frames-dir <folder>] [--screen 2560x1440] [--set edge_blur=1.2] [--params <file.json>] [--keep <folder>]

How: the YouTube player is HTML and CSS in Chrome, so the same Chrome (headless) draws the subtitles: the page repeats the DOM and the
styles of the player (div.caption-window → span.captions-text → span.caption-visual-line → span.ytp-caption-segment), the JS is a port of
the player code (captions.js: pen styles, windows, window places). The font is as in the player: fs 0 and 4 — "YouTube Noto", Roboto,
Arial…, sans-serif (checked against the player of 11.2026); they have no Hangul or other CJK glyphs, Chrome takes the system font for them
(Windows — Malgun Gothic), as the viewer's browser does. Roboto for Latin and digits comes from fonts.googleapis.com (no network — Arial).
Player metrics: the font size Wa = video height / 360 × 16, a pen — Wa × (1 + (sz/100 − 1)/4); the window place — 2 % + 0.96 × ah/av;
YouTube does not take fractional ah/av — the window goes to the bottom centre (the same here, with a warning); the edge et 3 — five
shadows "0 0 (Wa/16) px" in the colour ec; the line padding — 0.25 em; line-height: normal.
Every state (a set of windows between changes) is a transparent PNG; --frames — video stills with subtitles, --out — a video (an ffmpeg
overlay, libx264). Needs Chrome (CHROME or a default path), ffmpeg, Pillow.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import struct
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FONT_CSS = "https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,400;0,500;0,700;1,400&display=block"
CHROME = [os.environ.get("CHROME", ""), "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome",
          "/usr/bin/chromium"]

# Player knobs: the values are from the player code (10.2026); tune them to screenshots of the real player.
PARAMS = {
    "base_div": 360, "base_mul": 16,      # Wa = video height / base_div × base_mul
    "sz_slope": 0.25,                     # a pen: 1 + sz_slope × (sz/100 − 1); of 0 / 2 (sub/super) — × 0.8
    "sz_mul": {},                         # a pen size correction by sz: {"32": 0.95} — to screenshots
    "pos_k": 0.96, "pos_off": 2.0,        # the window place, % of the player: pos_off + pos_k × ah (av)
    "pad_em": 0.25,                       # the padding at the line ends (the first and the last segment)
    "line_height": "normal",              # a window line (the player: normal; the new player style — 1.375 at a segment)
    "new_style": False,                   # the player experiment enable_player_captions_new_style_defaults (rounded corners,
                                          # line-height 1.375, a default background of 0.7) — off as of 23.10.2026
    "edge_blur": 1.0,                     # the blur multiplier of the edge et 3 (the player: Wa/16 px)
    "edge_layers": 5,                     # the number of shadows of the edge et 3 (the player: 5)
    "edge_color": "",                     # the edge colour instead of ec ("" — as in the .ytt)
    "font_family": '"YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif',
    "smoothing": "antialiased",           # -webkit-font-smoothing of the player (only on macOS)
    "top_margin": 0, "bottom_margin": 0,  # the window margin from the controls, screen px: the controls hidden — 0 (shown: 69 / 70)
    "dpr": 1,                             # devicePixelRatio (et 1: a step of 0.5 px at ≥ 2)
    "display_icc": "",                   # an ICC profile of the monitor (a path from the project root): the layer colours as Chrome shows them on it; "" — no conversion
}

JS = r"""
const P = window.P, STATES = window.STATES;
function hex(c){c=c.replace('#','');if(c.length===3)c=c.split('').map(x=>x+x).join('');
  return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];}
function rgba(c,o){const v=hex(c);return 'rgba('+v[0]+','+v[1]+','+v[2]+','+o+')';}
function ssb(b){let s=1+P.sz_slope*(b.fontSizeIncrement||0);if(b.offset===0||b.offset===2)s*=.8;
  const k=b.fontSizeIncrement==null?null:String(Math.round((b.fontSizeIncrement+1)*100));
  if(k!==null&&P.sz_mul[k])s*=P.sz_mul[k];return s;}
const DEF = P.new_style ? {background:'#080808',backgroundOpacity:.7,charEdgeStyle:0,color:'#fff',fontFamily:4,
    fontSizeIncrement:0,textOpacity:1,offset:1} : {background:'#080808',backgroundOpacity:.75,charEdgeStyle:0,
    color:'#fff',fontFamily:4,fontSizeIncrement:0,textOpacity:1,offset:1};
const WDEF = {windowColor:'#080808',windowOpacity:0,textAlign:P.new_style?0:2,Dm:7,Zk:50,Jo:100};
const ALIGN = ['left','right','center','justify'];
function segStyle(b,Wa,Sa){  // Vsb of the player
  const c={};
  if(b.backgroundOpacity!=null||b.background){c.background=rgba(b.background,b.backgroundOpacity);
    if(P.new_style){c['box-decoration-break']='clone';c['-webkit-box-decoration-break']='clone';c['border-radius']=Sa*.25+'px';}}
  c['font-size']=Wa*ssb(b)+'px';
  if(P.new_style)c['line-height']='1.375';
  let d=1,e=b.color;
  if(b.color||b.textOpacity!=null){d=b.textOpacity==null?1:b.textOpacity;e=rgba(e,d);c.color=e;c.fill=e;}
  let f=b.charEdgeStyle;if(f===0)f=undefined;
  if(f){let ee='rgba(34, 34, 34, '+d+')',h='rgba(204, 204, 204, '+d+')';if(b.pT){h=ee=b.pT;}
    if(P.edge_color){h=ee=P.edge_color;}
    const l=Wa/16/2,m=Math.max(l,1),n=Math.max(2*l,1)*P.edge_blur;let p=Math.max(3*l,1);const q=Math.max(5*l,1);
    const arr=[];
    switch(f){case 4:for(;p<=q;p+=l)arr.push(n+'px '+n+'px '+p+'px '+ee);break;
      case 1:{const st=P.dpr>=2?.5:1;for(let x=m;x<=p;x+=st)arr.push(x+'px '+x+'px '+ee);}break;
      case 2:arr.push(m+'px '+m+'px '+h);arr.push('-'+m+'px -'+m+'px '+ee);break;
      case 3:for(let i=0;i<P.edge_layers;i++)arr.push('0 0 '+n+'px '+ee);}
    c['text-shadow']=arr.join(', ');}
  const FF={1:'"Courier New", Courier, "Nimbus Mono L", "Cutive Mono", serif-monospace, monospace',
    2:'"Times New Roman", Times, Georgia, Cambria, "PT Serif Caption", serif',
    3:'"Deja Vu Sans Mono", "Lucida Console", Monaco, Consolas, "PT Mono", sans-serif-monospace, monospace',
    5:'"Comic Sans MS", Impact, Handlee, fantasy',6:'"Monotype Corsiva", "URW Chancery L", "Apple Chancery", "Dancing Script", cursive',
    7:'Arial, Helvetica, Verdana, "Marcellus SC", sans-serif',0:P.font_family,4:P.font_family};
  if(FF[b.fontFamily])c['font-family']=FF[b.fontFamily];
  if(b.offset===0)c['vertical-align']='sub';if(b.offset===2)c['vertical-align']='super';
  if(b.fontFamily===7)c['font-variant']='small-caps';
  if(b.bold)c['font-weight']='bold';if(b.italic)c['font-style']='italic';if(b.underline)c['text-decoration']='underline';
  return c;}
function css(el,o){for(const k in o)el.style.setProperty(k,o[k]);}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function buildWindow(cont,w,Wa){  // B5 + Zsb/Xsb/Ysb of the player
  const q=Object.assign({},WDEF,w.ws,w.wp);
  const el=document.createElement('div');el.className='caption-window';
  const C=document.createElement('span');C.className='captions-text';C.setAttribute('style','word-wrap: normal; display: block;');
  el.appendChild(C);
  const Sa=Wa*ssb(DEF);
  let bg='';if(q.windowOpacity){bg=rgba(q.windowColor,q.windowOpacity);}
  css(el,{'background-color':bg,'text-align':ALIGN[q.textAlign]});
  if(P.new_style&&bg)css(el,{'border-radius':Sa*.25+'px'});
  if(q.Dm<=2)el.classList.add('ytp-caption-window-top');
  if(q.Dm>=6)el.classList.add('ytp-caption-window-bottom');
  cont.appendChild(el);
  let line=null,last=null,lastStyle=null;
  const newLine=()=>{line=document.createElement('span');line.style.display='block';line.className='caption-visual-line';C.appendChild(line);};
  const newSeg=(d)=>{const s=document.createElement('span');css(s,{display:'inline-block','white-space':'pre-wrap'});
    css(s,segStyle(d,Wa,Sa));s.classList.add('ytp-caption-segment');line.appendChild(s);return s;};
  w.segs.forEach((sg,i)=>{
    const d=Object.assign({},DEF,sg.pen);
    let c=!line;if(c)newLine();
    let e=(last&&lastStyle&&same(d,lastStyle))?last:newSeg(d);
    const parts=sg.text.split('\n');
    for(let l=0;l<parts.length;l++){const m=l>0||!(i>0);const n=parts[l];
      if(m&&!c){newLine();e=newSeg(d);}else if(m&&c){c=false;}
      if(n)e.appendChild(document.createTextNode(n));}
    lastStyle=d;last=e;});
  place(el,C,q);
}
function place(el,C,q){  // ME of the player
  css(el,{top:'0',left:'0',right:'',bottom:'',width:'',height:'','max-width':'96%','max-height':'96%',margin:'',transform:''});
  const f={transform:'',top:'',left:'',width:'',height:'','max-width':'','max-height':''};
  const h=q.Dm;let l=q.Zk*P.pos_k+P.pos_off;
  switch(h){case 0:case 3:case 6:f.left=l+'%';break;
    case 1:case 4:case 7:{f.left=l+'%';const n=C.offsetWidth;if(n){const b=n+1;f.width=b+'px';f['margin-left']=(b/-2)+'px';}
      else f.transform+=' translateX(-50%)';}break;
    case 2:case 5:case 8:f.right=(100-l)+'%';}
  const d=q.Jo*P.pos_k+P.pos_off;
  switch(h){case 0:case 1:case 2:f.top=d+'%';break;
    case 3:case 4:case 5:{f.top=d+'%';const ch=el.clientHeight;if(ch){f.height=ch+'px';f['margin-top']=(ch/-2)+'px';}
      else f.transform+=' translateY(-50%)';}break;
    case 6:case 7:case 8:f.bottom=(100-d)+'%';}
  css(el,f);
}
function build(){
  const W=window.TILE[0],H=window.TILE[1];
  STATES.forEach((st,k)=>{
    const t=document.createElement('div');t.className='tile';
    css(t,{left:(k%window.COLS)*W+'px',top:Math.floor(k/window.COLS)*H+'px',width:W+'px',height:H+'px'});
    const pl=document.createElement('div');pl.className='html5-video-player';t.appendChild(pl);
    const cont=document.createElement('div');cont.className='ytp-caption-window-container';pl.appendChild(cont);
    document.body.appendChild(t);
    const Wa=(H>=W? W/640: H/P.base_div)*P.base_mul;
    st.forEach(w=>buildWindow(cont,w,Wa));});
  document.title='done';
}
// all the faces and all the subsets (Cyrillic and others) — before measuring: otherwise the window width is measured with a fallback font
document.fonts.ready.then(()=>Promise.all([...document.fonts].map(f=>f.load().catch(()=>null))))
  .then(()=>document.fonts.ready).then(build);
"""

PAGE = """<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="{font}">
<style>html,body{{margin:0;padding:0;background:transparent;overflow:hidden}}
.tile{{position:absolute;overflow:hidden}}
.html5-video-player{{position:relative;width:100%;height:100%;overflow:hidden;z-index:0;outline:0;
font-family:YouTube Noto,Roboto,Arial,Helvetica,sans-serif;color:#eee;text-align:left;direction:ltr;font-size:11px;
line-height:1.3;-webkit-font-smoothing:{smoothing}}}
.ytp-caption-window-container{{width:100%;height:100%;position:absolute;top:0;pointer-events:none}}
.caption-window{{position:absolute;line-height:{lh};z-index:41}}
.caption-window.ytp-caption-window-top{{margin-top:{tm}px}}
.caption-window.ytp-caption-window-bottom{{margin-bottom:{bm}px}}
.html5-video-player .caption-visual-line .ytp-caption-segment:first-child{{padding-left:{pad}em;padding-top:0}}
.html5-video-player .caption-visual-line .ytp-caption-segment:last-child{{padding-right:{pad}em;padding-bottom:0}}
</style></head><body>
<script>window.P={params};window.TILE={tile};window.COLS={cols};window.STATES={states};</script>
<script>{js}</script></body></html>"""


SRGB_D50 = np.array([[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169],
                     [0.0139322, 0.0971045, 0.7141733]])


def icc_display(path):
    """sRGB → the monitor profile (ICC: rXYZ/gXYZ/bXYZ in D50 and the curves rTRC/gTRC/bTRC) — as Chrome converts the colours of a
    page. → a function (N×3 uint8) → (N×3 uint8)."""
    d = open(path, "rb").read()
    tags = {}
    for i in range(struct.unpack(">I", d[128:132])[0]):
        sig, off, size = struct.unpack(">4sII", d[132 + 12 * i:144 + 12 * i])
        tags[sig.decode("latin1")] = (off, size)

    def xyz(t):
        off = tags[t][0]
        return np.array(struct.unpack(">3i", d[off + 8:off + 20])) / 65536

    def inv_trc(t):
        off, size = tags[t]
        typ = d[off:off + 4]
        if typ == b"curv":
            n = struct.unpack(">I", d[off + 8:off + 12])[0]
            if n == 0:
                return lambda y: y
            if n == 1:
                g = struct.unpack(">H", d[off + 12:off + 14])[0] / 256
                return lambda y: np.power(y, 1 / g)
            tab = np.array(struct.unpack(">%dH" % n, d[off + 12:off + 12 + 2 * n])) / 65535
            xs = np.linspace(0, 1, n)
            return lambda y: np.interp(y, tab, xs)
        if typ == b"para":
            g = struct.unpack(">i", d[off + 12:off + 16])[0] / 65536
            return lambda y: np.power(y, 1 / g)
        raise ValueError(f"{path}: curve {t} of type {typ}")
    M = np.vstack([xyz("rXYZ"), xyz("gXYZ"), xyz("bXYZ")]).T
    A = np.linalg.solve(M, SRGB_D50)                     # linear sRGB → linear monitor
    inv = [inv_trc(t) for t in ("rTRC", "gTRC", "bTRC")]
    lin = np.where(np.arange(256) / 255 <= 0.04045, np.arange(256) / 255 / 12.92,
                   ((np.arange(256) / 255 + 0.055) / 1.055) ** 2.4)

    def f(rgb):
        y = np.clip(lin[rgb] @ A.T, 0, 1)
        return np.clip(np.round(np.stack([inv[k](y[:, k]) for k in range(3)], 1) * 255), 0, 255).astype(np.uint8)
    return f


def chrome():
    for p in CHROME:
        if p and os.path.exists(p):
            return p
    sys.exit("no Chrome: set its path in the CHROME variable")


# ---------- .ytt ----------

def parse_ytt(path):
    """The srv3 windows in document order: t0, t1 (s), wp (Dm, Zk, Jo), ws (textAlign, windowColor, windowOpacity),
    segs [{pen, text}] — a pen with its inheritance applied (the p attribute of a pen)."""
    root = ET.parse(path).getroot()
    head, body = root.find("head"), root.find("body")
    pens, wps, wss = {}, {}, {}
    num = lambda e, k: float(e.get(k)) if e.get(k) is not None else None   # noqa: E731
    for e in list(head) if head is not None else []:
        if e.tag == "pen":
            a = dict(pens.get(e.get("p"), {}))
            for k, key in (("b", "bold"), ("i", "italic"), ("u", "underline")):
                if e.get(k) is not None:
                    a[key] = e.get(k) == "1"
            for k, key in (("et", "charEdgeStyle"), ("of", "offset")):
                if e.get(k) is not None:
                    a[key] = int(e.get(k))
            if e.get("fs") not in (None, "0"):
                a["fontFamily"] = int(e.get("fs"))
            for k, key in (("bc", "background"), ("ec", "pT"), ("fc", "color")):
                if e.get(k) is not None:
                    a[key] = e.get(k)
            if e.get("sz") is not None:
                a["fontSizeIncrement"] = num(e, "sz") / 100 - 1
            if e.get("bo") is not None:
                a["backgroundOpacity"] = num(e, "bo") / 255
            if e.get("fo") is not None:
                a["textOpacity"] = num(e, "fo") / 255
            pens[e.get("id")] = a
        elif e.tag == "ws":
            a = dict(wss.get(e.get("ws"), {}))
            if e.get("ju") is not None:
                a["textAlign"] = int(e.get("ju"))
            if e.get("wfc") is not None:
                a["windowColor"] = e.get("wfc")
            if e.get("wfo") is not None:
                a["windowOpacity"] = num(e, "wfo") / 255
            wss[e.get("id")] = a
        elif e.tag == "wp":
            a = dict(wps.get(e.get("wp"), {}))
            for k, key in (("ap", "Dm"), ("ah", "Zk"), ("av", "Jo")):
                if e.get(k) is not None:
                    a[key] = num(e, k)
            bad = [f'{k}="{e.get(k)}"' for k in ("ah", "av")
                   if e.get(k) is not None and not re.fullmatch(r"-?\d+", e.get(k).strip())]
            if bad:                                    # as YouTube does: a fractional place — the default window, bottom centre
                print(f"ytt_burn: window wp {e.get('id')}: fractional {' '.join(bad)} — YouTube puts it at the bottom centre "
                      f"(ap 7, ah 50, av 100), drawn there too", file=sys.stderr)
                a.update(Dm=7.0, Zk=50.0, Jo=100.0)
            wps[e.get("id")] = a
    out = []
    for p in body.iter("p") if body is not None else []:
        t0 = (num(p, "t") or 0) / 1000
        t1 = t0 + (num(p, "d") if p.get("d") is not None else 5000) / 1000
        ppen = pens.get(p.get("p"), {})
        segs = []
        if p.text:
            segs.append({"pen": ppen, "text": p.text})
        for s in p:
            if s.tag == "s":
                segs.append({"pen": pens.get(s.get("p"), {}) if s.get("p") else {}, "text": s.text or ""})
            elif s.tag == "br":
                segs.append({"pen": ppen, "text": "\n"})
            if s.tail:
                segs.append({"pen": ppen, "text": s.tail})
        if segs:
            out.append(dict(t0=t0, t1=t1, wp=wps.get(p.get("wp"), {}), ws=wss.get(p.get("ws"), {}), segs=segs))
    return out


def states_of(wins, a, z):
    """Changes of the window set on [a, z): [(t0, t1, [windows in the order of appearance])]."""
    cuts = sorted({a, z} | {w["t0"] for w in wins if a < w["t0"] < z} | {w["t1"] for w in wins if a < w["t1"] < z})
    order = sorted(range(len(wins)), key=lambda i: (wins[i]["t0"], i))
    out = []
    for t0, t1 in zip(cuts, cuts[1:]):
        mid = (t0 + t1) / 2
        act = [wins[i] for i in order if wins[i]["t0"] <= mid < wins[i]["t1"]]
        out.append((t0, t1, act))
    return out


# ---------- pictures of the states ----------

def render_states(states, screen, size, P, tmp, batch_px=64e6):
    """A PNG for every non-empty state (equal ones — one file): {key: path}. Chrome draws them as a grid of tiles."""
    uniq = {}
    for _, _, act in states:
        if act:
            k = json.dumps(act, sort_keys=True, ensure_ascii=False)
            uniq.setdefault(k, act)
    keys = list(uniq)
    W, H = screen
    cols = max(1, min(len(keys), int(15000 // W)))
    per = max(1, min(int(batch_px // (W * H)), cols * max(1, int(15000 // H))))
    paths = {}
    exe = chrome()
    icc = P.get("display_icc")
    conv = icc_display(icc if os.path.isabs(icc) else os.path.join(ROOT, icc)) if icc else None
    font = FONT_CSS
    for b0 in range(0, len(keys), per):
        chunk = keys[b0:b0 + per]
        c = min(cols, len(chunk))
        r = -(-len(chunk) // c)
        page = os.path.join(tmp, f"page_{b0}.html")
        with open(page, "w", encoding="utf-8") as f:
            f.write(PAGE.format(font=font, smoothing=P["smoothing"], lh=P["line_height"], tm=P["top_margin"],
                                bm=P["bottom_margin"], pad=P["pad_em"], params=json.dumps(P), tile=json.dumps([W, H]),
                                cols=c, states=json.dumps([uniq[k] for k in chunk], ensure_ascii=False), js=JS))
        shot = os.path.join(tmp, f"shot_{b0}.png")
        subprocess.run([exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                        "--default-background-color=00000000", "--allow-file-access-from-files",
                        "--virtual-time-budget=10000", f"--window-size={c * W},{r * H}", f"--screenshot={shot}",
                        "file:///" + os.path.abspath(page).replace("\\", "/").lstrip("/")],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        im = Image.open(shot).convert("RGBA")
        for i, k in enumerate(chunk):
            x, y = (i % c) * W, (i // c) * H
            tile = im.crop((x, y, x + W, y + H))
            if (W, H) != tuple(size):          # a screen of another size — to the video size (with premultiplied alpha)
                tile = tile.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")
            if conv:                           # the colours — to the monitor profile, as Chrome does (the video — without a conversion)
                px = np.array(tile)
                m = px[..., 3] > 0
                px[..., :3][m] = conv(px[..., :3][m])
                tile = Image.fromarray(px, "RGBA")
            p = os.path.join(tmp, f"st_{b0 + i:05d}.png")
            tile.save(p, optimize=False, compress_level=1)
            paths[k] = p
        os.remove(shot)
    return paths


def overlay_list(states, paths, size, tmp):
    blank = os.path.join(tmp, "blank.png")
    Image.new("RGBA", size, (0, 0, 0, 0)).save(blank)
    lst = os.path.join(tmp, "overlay.txt")
    with open(lst, "w", encoding="utf-8") as f:
        last = blank
        for t0, t1, act in states:
            p = paths[json.dumps(act, sort_keys=True, ensure_ascii=False)] if act else blank
            f.write("file '%s'\nduration %.4f\n" % (p.replace("\\", "/"), t1 - t0))
            last = p
        f.write("file '%s'\n" % last.replace("\\", "/"))
    return lst


def probe(video):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height:format=duration", "-of", "json", video],
                         capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    return (j["streams"][0]["width"], j["streams"][0]["height"]), float(j["format"]["duration"])


def state_at(states, t):
    for t0, t1, act in states:
        if t0 <= t < t1:
            return act
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ytt", required=True)
    ap.add_argument("--video", required=True, help="a video without language text")
    ap.add_argument("--out", help="an mp4 with burnt-in subtitles")
    ap.add_argument("--from", dest="t_from", type=float, default=0.0)
    ap.add_argument("--to", type=float, help="the end, s (default — the video length)")
    ap.add_argument("--frames", help="stills at these seconds: 9.5,20 (video + subtitles, PNG)")
    ap.add_argument("--frames-dir", help="the stills folder (default — next to --out or the .ytt)")
    ap.add_argument("--screen", help="the screen size of the viewer WxH: draw in it and bring to the video size "
                    "(default — the video size)")
    ap.add_argument("--set", action="append", default=[], help="a player parameter: name=value (PARAMS)")
    ap.add_argument("--params", help="a JSON with player parameters")
    ap.add_argument("--keep", help="keep the PNGs of the states in this folder")
    a = ap.parse_args()
    P = dict(PARAMS)
    if a.params:
        P.update(json.load(open(a.params, encoding="utf-8")))
    for kv in a.set:
        k, v = kv.split("=", 1)
        if k not in P:
            sys.exit(f"no parameter {k}: {', '.join(P)}")
        P[k] = json.loads(v) if v[:1] in "0123456789-[{\"" or v in ("true", "false") else v
    size, dur = probe(a.video)
    screen = tuple(int(x) for x in a.screen.lower().split("x")) if a.screen else size
    t_to = a.to if a.to is not None else dur
    wins = parse_ytt(a.ytt)
    states = states_of(wins, a.t_from, t_to)
    tmp = tempfile.mkdtemp(prefix="ytt_burn_")
    try:
        if a.frames:                               # only the states of the stills
            ts = [float(x) for x in a.frames.split(",")]
            sel = [(t, t, state_at(states, t)) for t in ts]
            paths = render_states(sel, screen, size, P, tmp)
            fd = a.frames_dir or os.path.dirname(os.path.abspath(a.out or a.ytt))
            os.makedirs(fd, exist_ok=True)
            base = os.path.splitext(os.path.basename(a.ytt))[0]
            for t, _, act in sel:
                fr = os.path.join(tmp, "fr.png")
                subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.3f}", "-i", a.video, "-frames:v", "1", fr],
                               check=True)
                im = Image.open(fr).convert("RGBA")
                if act:
                    im.alpha_composite(Image.open(paths[json.dumps(act, sort_keys=True, ensure_ascii=False)]))
                p = os.path.join(fd, f"{base}_{t:07.2f}.png")
                im.convert("RGB").save(p)
                print("frame:", p)
            if not a.out:
                return
        paths = render_states(states, screen, size, P, tmp)
        print(f"windows {len(wins)}, states {len(states)}, pictures {len(paths)}")
        if a.keep:
            os.makedirs(a.keep, exist_ok=True)
            for p in paths.values():
                shutil.copy2(p, a.keep)
        if not a.out:
            return
        lst = overlay_list(states, paths, size, tmp)
        cut = ["-ss", f"{a.t_from:.3f}", "-to", f"{t_to:.3f}"] if a.t_from or a.to is not None else []
        subprocess.run(["ffmpeg", "-y", "-v", "error", *cut, "-i", a.video, "-f", "concat", "-safe", "0", "-i", lst,
                        "-filter_complex", "[1:v]format=rgba,scale=out_color_matrix=bt709:out_range=tv,format=yuva420p[o];"
                        "[0:v][o]overlay=0:0:eof_action=pass:format=yuv420[v]", "-map", "[v]", "-map", "0:a?",
                        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
                        "-color_primaries", "bt709", "-color_trc", "bt709", "-c:a", "copy", "-movflags", "+faststart", a.out], check=True)
        print("video:", a.out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
