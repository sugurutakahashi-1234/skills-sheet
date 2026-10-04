#!/usr/bin/env python3
"""変更履歴ビュー: ファイルの before / after を 1 本の文書として並べ、削除を赤の取り消し線・追加を緑の下線で示す。
行ごとに「戻す」とコメントを付け、章ごとに回答をまとめてコピーできる。

使い方:
  python3 redline.py <repo> <file> <before_ref> <out.html> [開始章] [###で章を割るH2名,…] [--notes notes.json] [--done 章名,…] [--edit] [--alts alts.json]
  例: python3 redline.py . README.md HEAD~5 /tmp/redline.html "案件詳細 › [No.11] …" 案件詳細 --notes /tmp/notes.json

  --notes は {行の文字列: 理由} の JSON。変更・削除・追加した行のうち、文字列が一致する行の下に理由を出す
  （行の文字列は先頭の `- ` と字下げを除いたもの。書き換えた行は変更後の文字列で引く）。
  --done は回答を反映し終えた章（`|` 区切り）。タブに「反映済み」と出し、もう一度の回答を求めない。
  開始章・第 6 引数・--done の章名は、見出しの番号（`4. ` `5.1 `）を除いて比べる。番号付きの文書でも `案件詳細` と書けばよい。

  --edit は編集モード。右の列（案）を、その場で書き換えられる欄にする。左（元の文）と右を同じ文字の大きさの Markdown のまま並べ、
  書き換えるたびに元の文との違いを色で出す。行ごとに「元の文にする」「案に戻す」とコメント。送る内容は、案から直した行の
  「案 → 直した文」（行頭の `- ` や見出しの # も含めた 1 行）とコメント。

  --alts は {案の行の文字列: [候補, …]} の JSON（--edit と一緒に使う）。その行の下に候補を並べ、押すと右の欄に入る。
  案が通らなかった行・言い回しの好みが分かれる行にだけ付ける（全部の行に付けると読むのがつらい）。

  入力中の印とコメントはブラウザに保存する（localStorage。キーは出力先のパス）。同じ出力先に作り直したページは、
  「再読み込み」ボタンで読み込めば入力が残る。ページは自動では読み込み直さない。

  before_ref は git のリビジョン。章は `## ` 見出しごと。第 6 引数に H2 名を渡すと、その H2 の配下だけ `### ` でさらに割る。
"""
import sys, io, re, html, difflib, subprocess, json, os, hashlib, time
argv = sys.argv[1:]; NOTES = {}; DONE = []
EDIT = '--edit' in argv
if EDIT: argv.remove('--edit')
ALTS = {}
if '--alts' in argv:
    k = argv.index('--alts'); ALTS = json.load(io.open(argv[k+1], encoding='utf-8')); del argv[k:k+2]
if '--notes' in argv:
    k = argv.index('--notes'); NOTES = json.load(io.open(argv[k+1], encoding='utf-8')); del argv[k:k+2]
if '--done' in argv:
    k = argv.index('--done'); DONE = [c for c in argv[k+1].split('|') if c]; del argv[k:k+2]
if len(argv) < 4:
    print(__doc__); sys.exit(1)
repo, path, before_ref, out = argv[0:4]
start = argv[4] if len(argv) > 4 else ''
# 見出しに番号（`## 4. 案件詳細` `### 5.1 AI`）が付いた文書でも、章の名前は番号を除いて比べる
strip_no = lambda t: re.sub(r'^\d+(?:\.\d+)*\.?\s+', '', t.strip())
norm = lambda ch: ' › '.join(strip_no(x) for x in ch.split(' › '))
split_h3 = {strip_no(x) for x in argv[5].split(',')} if len(argv) > 5 else set()
old = subprocess.run(['git','show',f'{before_ref}:{path}'],capture_output=True,text=True,cwd=repo).stdout.split('\n')
new = io.open(os.path.join(repo,path),encoding='utf-8').read().split('\n')

def md_inline(t):
    t = html.escape(t)
    t = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'<span class="lnk">\1</span>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    return t
def cls_of(line):
    if line.startswith('#### '): return 'h4', line[5:]
    if line.startswith('### '): return 'h3', line[4:]
    if line.startswith('## '): return 'h2', line[3:]
    if line.startswith('# '): return 'h1', line[2:]
    m = re.match(r'^(\s*)[-*] (.*)$', line)
    if m: return f'li d{len(m.group(1))//2}', m.group(2)
    if line.startswith('<'): return 'raw', ''
    return 'p', line
# `名前` とリンクはひとかたまりで比べる。1 文字ずつだとバッククォートの組が差分で分断され、` がそのまま出る
TOKEN = re.compile(r'`[^`]+`|\[[^\]]+\]\([^)]*\)|.', re.S)
def char_diff(a, b):
    ta, tb = TOKEN.findall(a), TOKEN.findall(b)
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False); oa=[]; ob=[]
    j = lambda xs: md_inline(''.join(xs))
    for op,i1,i2,j1,j2 in sm.get_opcodes():
        if op=='equal': oa.append(j(ta[i1:i2])); ob.append(j(tb[j1:j2]))
        elif op=='delete': oa.append(f'<del>{j(ta[i1:i2])}</del>')
        elif op=='insert': ob.append(f'<ins>{j(tb[j1:j2])}</ins>')
        else: oa.append(f'<del>{j(ta[i1:i2])}</del>'); ob.append(f'<ins>{j(tb[j1:j2])}</ins>')
    return ''.join(oa), ''.join(ob)

rows=[]; stats={'del':0,'ins':0,'chg':0}; texts={}; seen={}; chsrc={}
CH=['（冒頭）']; H2=['']; chapters=['（冒頭）']
def chapter_of(line):
    if line.startswith('## '): H2[0]=line[3:].strip(); return H2[0]
    m=re.match(r'^### (.*)$', line)
    if m and strip_no(H2[0]) in split_h3: return f'{H2[0]} › {m.group(1).strip()}'
    return None
def enter(line):
    ch=chapter_of(line)
    if ch: CH[0]=ch; chapters.append(ch)
pre=lambda line,t: line[:len(line)-len(t)]
def add(kind, cls, left, right, n, plain, raw=None):
    if cls=='raw': return
    key=f'r{len(rows)}'; texts[key]={'n':n,'kind':kind,'text':plain,'ch':CH[0]}
    # 編集モードでは、行頭（`  - ` や `#### `）と本文を分けて持つ。欄で書き換えるのは本文だけ
    if EDIT and raw: texts[key].update(lp=raw[0],lt=raw[1],rp=raw[2],rt=raw[3])
    # 作り直したページでも入力を引き継げるよう、章・種類・文字列（同じ行が続くときは出現順）から ID を作る
    base=f'{CH[0]}\x01{kind}\x01{plain}'; seen[base]=seen.get(base,0)+1
    sid=hashlib.sha1(f'{base}\x01{seen[base]}'.encode()).hexdigest()[:12]
    if kind!='eq': chsrc.setdefault(CH[0],[]).append(f'{kind}\x01{left}\x01{right}')
    act=('<button data-act="rev">戻す</button>' if kind!='eq' else '')+'<button data-act="cmt">コメント</button>'
    why=f'<span class="why">{html.escape(NOTES[plain])}</span>' if kind!='eq' and plain in NOTES else ''
    if EDIT and raw and cls not in ('h1','h2') and not (kind=='eq' and not plain):
        # 右は書き換えられる欄（contenteditable）。太字・リンク・コードを描いたまま直せ、送るときに Markdown へ戻す
        act='<button data-act="orig" title="元の文にする">元の文</button><button data-act="prop" title="案に戻す">案</button><button data-act="cmt">コメント</button>'
        # 候補: ⠿ をドラッグすると候補をまるごと、文字を選んでドラッグすると一部だけを右の欄に入れられる。「使う」で置き換え
        alts=''.join(f'<span class="alt" data-alt="{html.escape(a)}"><span class="grip" draggable="true" title="ドラッグして右の欄に入れる">⠿</span><span class="altx"></span><button class="use">使う</button></span>' for a in ALTS.get(plain,[]))
        alts=f'<span class="alts"><span class="altl">候補（「使う」で置き換え。⠿ や選んだ文字をドラッグすると右の欄に入る）</span>{alts}</span>' if alts else ''
        # コメント欄は行の下に横いっぱいで開く（右の狭い列だと、書くほど文字が見えなくなる）
        rows.append(f'<div class="row {kind} {cls} er" data-key="{key}" data-sid="{sid}" data-ch="{html.escape(CH[0])}"><span class="n">{n or ""}</span><span class="l"><span class="lt"></span></span><span class="r"><span class="ce" contenteditable="true" spellcheck="false"></span></span><span class="act">{act}</span>{why}{alts}</div><div class="cbox" data-for="{key}" hidden><textarea placeholder="この行へのコメント（直した理由、迷っている点、など）"></textarea></div>')
        return
    rows.append(f'<div class="row {kind} {cls}" data-key="{key}" data-sid="{sid}" data-ch="{html.escape(CH[0])}"><span class="n">{n or ""}</span><span class="l">{left}</span><span class="r">{right}</span><span class="act">{act}</span>{why}</div><div class="cbox" data-for="{key}" hidden><textarea placeholder="この行へのコメント（戻す理由、別の言い方、など）"></textarea></div>')
sm = difflib.SequenceMatcher(None, old, new, autojunk=False)
for op,i1,i2,j1,j2 in sm.get_opcodes():
    if op=='equal':
        for k in range(j1,j2):
            enter(new[k]); c,t=cls_of(new[k]); h=md_inline(t); add('eq',c,h,h,k+1,t,(pre(new[k],t),t,pre(new[k],t),t))
    elif op=='delete':
        for k in range(i1,i2):
            c,t=cls_of(old[k]); add('del',c,f'<del>{md_inline(t)}</del>','',None,t,(pre(old[k],t),t,pre(old[k],t),'')); stats['del']+=1
    elif op=='insert':
        for k in range(j1,j2):
            enter(new[k]); c,t=cls_of(new[k]); add('ins',c,'',f'<ins>{md_inline(t)}</ins>',k+1,t,(pre(new[k],t),'',pre(new[k],t),t)); stats['ins']+=1
    else:
        a=old[i1:i2]; b=new[j1:j2]; ev=[]
        # 見出しと子行のように階層や太字の有無が違う行どうしは、文字が似ていても対応づけない
        shape=lambda t: (cls_of(t)[0], cls_of(t)[1].startswith('**'))
        sim=lambda x,y: difflib.SequenceMatcher(None,x,y).ratio() if shape(x)==shape(y) else 0.0
        if len(a)==len(b):
            # 行数が同じ置き換えは位置で対応づける。似ていない行は「削除 → 追加」を同じ位置に並べる
            for k in range(len(a)):
                if sim(a[k],b[k])>=0.3: ev.append(('chg',k,k))
                else: ev.append(('del',k,None)); ev.append(('ins',None,k))
        else:
            pairs={}; used=set()
            for ia,la in enumerate(a):
                best=None; bs=0.0
                for ib,lb in enumerate(b):
                    if ib in used: continue
                    r=sim(la,lb)
                    if r>bs: bs,best=r,ib
                if best is not None and bs>=0.45: pairs[ia]=best; used.add(best)
            # 右列が追加後の並び順になるように出す。対応のない旧行は、次に対応する旧行の直前に置く
            keyed=[]
            for ia in range(len(a)):
                if ia in pairs: keyed.append((pairs[ia],0,('chg',ia,pairs[ia])))
                else:
                    nxt=[pairs[x] for x in range(ia+1,len(a)) if x in pairs]
                    keyed.append(((nxt[0] if nxt else len(b))-0.5,0,('del',ia,None)))
            for ib in range(len(b)):
                if ib not in used: keyed.append((ib,1,('ins',None,ib)))
            ev=[e for _,_,e in sorted(keyed,key=lambda t:(t[0],t[1]))]
        for kind,ia,ib in ev:
            if kind=='del':
                ca,ta=cls_of(a[ia]); add('del',ca,f'<del>{md_inline(ta)}</del>','',None,ta,(pre(a[ia],ta),ta,pre(a[ia],ta),'')); stats['del']+=1
            elif kind=='ins':
                lb=b[ib]; enter(lb); cb,tb=cls_of(lb); add('ins',cb,'',f'<ins>{md_inline(tb)}</ins>',j1+ib+1,tb,(pre(lb,tb),'',pre(lb,tb),tb)); stats['ins']+=1
            else:
                ca,ta=cls_of(a[ia]); enter(b[ib]); cb,tb=cls_of(b[ib])
                # 太字の項目名どうしは ** を外して比べる（差分で ** が分断されると太字にならない）
                bold=all(t.startswith('**') and t.endswith('**') and len(t)>4 for t in (ta,tb))
                da,db=char_diff(ta[2:-2],tb[2:-2]) if bold else char_diff(ta,tb)
                if bold: da,db=f'<b>{da}</b>',f'<b>{db}</b>'
                add('chg',cb,da,db,j1+ib+1,tb,(pre(a[ia],ta),ta,pre(b[ib],tb),tb)); stats['chg']+=1

EDIT_CSS = '''
body.edit .row{grid-template-columns:34px 1fr 1fr 150px}
body.edit .bar #side,body.edit .bar #stack{display:none}
.er .l,.er .r{display:flex;gap:6px}.er.li .l::before,.er.li .r::before{flex:none}
.lt,.ce{display:block;flex:1;min-width:0;font:inherit;line-height:1.7;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;box-sizing:border-box;margin:0;padding:2px 6px;border:1px solid transparent;border-radius:4px}
.ce{border-color:#d1d9e0;min-height:1.7em;outline:none;color:#1f2328}.ce:focus{outline:2px solid #54aeff;outline-offset:-1px}
.ce:empty::before{content:'（削除）';color:#a40e26}
.ce b,.lt b,.altx b{font-weight:700}.ce .lnk,.lt .lnk,.altx .lnk{color:#0969da;text-decoration:underline}
.er.eq .lt,.er.eq .ce{color:#57606a}.er.diff .lt{background:#fff5f5}.er.diff .ce{background:#f0fff4}
.er.edited .ce{border-color:#d4a72c}.er.edited .n{color:#9a6700;font-weight:700}
.ce ins,.altx ins{text-decoration:none;background:#acf2bd;color:#0f5323}.lt del{background:#ffcecb}
body.edit .act{flex-wrap:nowrap;justify-content:flex-end;gap:3px;opacity:.35}body.edit .act button{flex:0 0 auto;padding:2px 6px;font-size:11px}
body.edit .row:hover .act,body.edit .row.edited .act,body.edit .row.has-c .act{opacity:1}
body.edit .cbox textarea{min-height:64px}
.alts{grid-column:3/5;display:flex;flex-direction:column;gap:4px;margin:2px 0 8px}.altl{font-size:12px;font-weight:600;color:#59636e}
.alt{display:flex;align-items:center;gap:8px;line-height:1.6;padding:4px 8px;border:1px solid #d1d9e0;border-radius:6px;background:#f6f8fa}
.alt.on{border-color:#1f883d;background:#dafbe1}.altx{flex:1;min-width:0}
.grip{cursor:grab;color:#8c959f;user-select:none;font-size:14px}.grip:active{cursor:grabbing}
.alt .use{flex:none;font-size:11px;padding:2px 8px;border:1px solid #d1d9e0;border-radius:6px;background:#fff;cursor:pointer}
.alt .use:hover{border-color:#54aeff;background:#ddf4ff}
'''
EDIT_JS = r'''
/* ---- 編集ビュー: 太字・リンク・コードを描いたまま、その場で書き換える（contenteditable） ---- */
const escH=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
/* Markdown の 1 行を、文字ごとの見た目（b: 太字 / c: コード / h: リンク先）に分ける */
function parseMd(s,st={}){const out=[],re=/\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]*)\)/g;let i=0,m;
  while((m=re.exec(s))){for(const ch of s.slice(i,m.index))out.push({ch,...st});
    if(m[1]!==undefined)out.push(...parseMd(m[1],{...st,b:true}));
    else if(m[2]!==undefined)for(const ch of m[2])out.push({ch,...st,c:true});
    else out.push(...parseMd(m[3],{...st,h:m[4]}));
    i=re.lastIndex;}
  for(const ch of s.slice(i))out.push({ch,...st});return out;}
/* 文字ごとの見た目から Markdown に戻す。太字は続く範囲を 1 組の ** でくくる */
function toMd(cs){let o='',b=false,i=0;
  while(i<cs.length){const c=cs[i];if(!!c.b!==b){o+='**';b=!!c.b;}
    if(c.h!==undefined){let t='';const h=c.h;while(i<cs.length&&cs[i].h===h&&!!cs[i].b===b){t+=cs[i].ch;i++;}o+='['+t+']('+h+')';continue;}
    if(c.c){let t='';while(i<cs.length&&cs[i].c&&!!cs[i].b===b&&cs[i].h===undefined){t+=cs[i].ch;i++;}o+='`'+t+'`';continue;}
    o+=c.ch;i++;}
  if(b)o+='**';return o;}
const normMd=s=>toMd(parseMd(s));
/* 見た目つきの文字を HTML にする。marks は文字ごとの ins / del */
function renderCs(cs,marks){let o='',i=0;const key=k=>{const c=cs[k];return [c.b?1:0,c.c?1:0,c.h===undefined?'\u0000':c.h,marks?marks[k]:''].join('\u0001');};
  while(i<cs.length){const k0=key(i),c=cs[i],mk=marks?marks[i]:'';let t='';while(i<cs.length&&key(i)===k0){t+=cs[i].ch;i++;}
    let h=escH(t);if(c.c)h='<code>'+h+'</code>';if(c.h!==undefined)h='<span class="lnk" data-href="'+escH(c.h)+'">'+h+'</span>';if(c.b)h='<b>'+h+'</b>';if(mk)h='<'+mk+'>'+h+'</'+mk+'>';o+=h;}
  return o;}
/* 見えている文字どうしを比べ、左に消える文字（del）・右に足した文字（ins）の印を付ける */
function diffCs(A,B){const n=A.length,m=B.length,dp=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=A[i].ch===B[j].ch?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  const ma=new Array(n).fill(''),mb=new Array(m).fill('');let i=0,j=0;
  while(i<n&&j<m){if(A[i].ch===B[j].ch){i++;j++;}else if(dp[i+1][j]>=dp[i][j+1])ma[i++]='del';else mb[j++]='ins';}
  while(i<n)ma[i++]='del';while(j<m)mb[j++]='ins';return [ma,mb];}
/* 欄の中身（HTML）を Markdown に戻す。ins / del や貼り付けで入った要素は中身だけ使う */
function domMd(node){let o='';node.childNodes.forEach(n=>{if(n.nodeType===3){o+=n.nodeValue;return;}if(n.nodeType!==1)return;const t=n.tagName,inner=domMd(n);
  if(t==='B'||t==='STRONG')o+='**'+inner+'**';else if(t==='CODE')o+='`'+inner+'`';
  else if(n.classList.contains('lnk'))o+='['+inner+']('+(n.dataset.href||'')+')';else if(t==='A')o+='['+inner+']('+(n.getAttribute('href')||'')+')';
  else if(t!=='BR')o+=inner;});
  return o.replace(/ /g,' ').replace(/\n/g,' ');}
/* 描き直してもカーソルが動かないよう、見えている文字の何文字目かで覚えて戻す */
function caretOf(el){const s=getSelection();if(!s.rangeCount||!el.contains(s.anchorNode))return null;const pre=document.createRange();pre.selectNodeContents(el);const r=s.getRangeAt(0);pre.setEnd(r.endContainer,r.endOffset);return pre.toString().length;}
function setCaret(el,off){if(off===null)return;const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n,acc=0;const put=(node,o)=>{const r=document.createRange();if(node)r.setStart(node,o);else{r.selectNodeContents(el);r.collapse(false);}r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);};
  while((n=w.nextNode())){if(acc+n.length>=off){put(n,off-acc);return;}acc+=n.length;}put(null,0);}
const curOf=key=>{const s=state[key];return s&&s.t!==undefined?s.t:TEXTS[key].rtn;};
function paint(r,keep){const key=r.dataset.key,t=TEXTS[key],v=curOf(key),A=parseMd(t.ltn),Bc=parseMd(v),d=diffCs(A,Bc),ce=r.querySelector('.ce');
  r.querySelector('.lt').innerHTML=renderCs(A,d[0]);const off=keep?caretOf(ce):null;ce.innerHTML=renderCs(Bc,d[1]);if(keep)setCaret(ce,off);
  r.classList.toggle('edited',v!==t.rtn);r.classList.toggle('diff',v!==t.ltn);
  r.querySelectorAll('.alt').forEach(a=>a.classList.toggle('on',normMd(a.dataset.alt)===v));}
function setText(r,md){const key=r.dataset.key;state[key]=state[key]||{};const v=normMd(md);if(v===TEXTS[key].rtn)delete state[key].t;else state[key].t=v;paint(r,false);}
function initEdit(){rows.forEach(r=>{const ce=r.querySelector('.ce');if(!ce)return;const key=r.dataset.key,t=TEXTS[key];t.rtn=normMd(t.rt);t.ltn=normMd(t.lt);
  let composing=false;
  const commit=()=>{const v=normMd(domMd(ce));state[key]=state[key]||{};if(v===t.rtn)delete state[key].t;else state[key].t=v;paint(r,true);sum();};
  /* 日本語の変換中に描き直すと変換が壊れるので、確定してから差分を描く */
  ce.addEventListener('compositionstart',()=>{composing=true;});
  ce.addEventListener('compositionend',()=>{composing=false;commit();});
  ce.addEventListener('input',e=>{if(composing||e.isComposing)return;commit();});
  ce.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing)e.preventDefault();});
  ce.addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,(e.clipboardData.getData('text/plain')||'').replace(/\s*\n\s*/g,' '));});
  /* 候補（⠿ か選んだ文字）を落とした位置に、文字だけを入れる。欄の中で文字を動かすときはブラウザに任せる */
  let inner=false;ce.addEventListener('dragstart',()=>{inner=true;});ce.addEventListener('dragend',()=>{inner=false;});
  ce.addEventListener('dragover',e=>{if(inner)return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
  ce.addEventListener('drop',e=>{if(inner)return;const txt=(e.dataTransfer.getData('text/plain')||'').replace(/\s*\n\s*/g,' ');if(!txt)return;e.preventDefault();
    const rg=document.caretRangeFromPoint?document.caretRangeFromPoint(e.clientX,e.clientY):null;ce.focus();
    const sel=getSelection();if(rg&&ce.contains(rg.startContainer)){sel.removeAllRanges();sel.addRange(rg);}else{const r=document.createRange();r.selectNodeContents(ce);r.collapse(false);sel.removeAllRanges();sel.addRange(r);}
    document.execCommand('insertText',false,txt);});
  r.querySelectorAll('.alt').forEach(a=>{a.querySelector('.altx').innerHTML=renderCs(parseMd(a.dataset.alt));
    a.querySelector('.use').onclick=()=>{setText(r,a.dataset.alt);sum();ce.focus();};
    a.querySelector('.grip').addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',a.dataset.alt);e.dataTransfer.effectAllowed='copy';});});
  paint(r,false);});}
'''
page=f'''<!doctype html><html lang="ja"><meta charset="utf-8"><title>{html.escape(path)} の変更履歴ビュー</title>
<style>
:root{{color-scheme:light}}body{{margin:0;padding:24px 24px 40px;background:#f6f8fa;color:#1f2328;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}}
.wrap{{max-width:1400px;margin:0 auto}}h1{{font-size:20px;margin:0 0 6px}}.note{{font-size:13px;color:#59636e;margin:0 0 12px}}
.bar{{position:sticky;top:0;z-index:5;background:#f6f8fa;padding:8px 0;border-bottom:1px solid #d1d9e0;margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}}
.bar button,.act button,.foot button{{font-size:12px;padding:3px 10px;border:1px solid #d1d9e0;border-radius:6px;background:#fff;cursor:pointer;color:#1f2328}}
.bar button.on{{background:#ddf4ff;border-color:#54aeff}}.bar .sp{{flex:1}}
.tabs{{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}}.tabs button{{font-size:13px;padding:5px 12px;border:1px solid #d1d9e0;border-radius:999px;background:#fff;cursor:pointer}}.tabs button.on{{background:#1f2328;color:#fff;border-color:#1f2328}}.tabs .st{{margin-left:6px;font-size:11px;font-weight:600;padding:0 6px;border-radius:999px}}.tabs .st.todo{{background:#fff1e5;color:#bc4c00}}.tabs .st.wip{{background:#fff8c5;color:#7d4e00}}.tabs .st.ok{{background:#dafbe1;color:#116329}}#warn{{font-weight:600;color:#bc4c00}}#warn.ok{{color:#1a7f37}}.tabs button .c{{opacity:.6;font-size:11px;margin-left:4px}}
.doc{{background:#fff;border:1px solid #d1d9e0;border-radius:6px;padding:12px 16px}}
.row{{display:grid;grid-template-columns:34px 1fr 1fr 110px;gap:0 10px;align-items:start;padding:1px 0;border-bottom:1px solid #f3f4f6}}
.row .n{{text-align:right;color:#8c959f;font-size:11px;padding-top:5px;user-select:none}}.row .l,.row .r{{min-width:0;padding:2px 6px;border-radius:4px}}
.row .act{{display:flex;gap:4px;justify-content:flex-end;opacity:.25;transition:opacity .15s}}.row:hover .act,.row.marked .act,.row.has-c .act{{opacity:1}}
.act button.on{{background:#ffebe9;border-color:#ff8182;color:#a40e26}}.act button.on2{{background:#fff3c4;border-color:#d4a72c;color:#7d4e00}}
.h1 .l,.h1 .r{{font-size:22px;font-weight:700;margin:4px 0}}.h2 .l,.h2 .r{{font-size:19px;font-weight:700;margin:18px 0 4px;padding-bottom:3px;border-bottom:1px solid #d1d9e0}}.h3 .l,.h3 .r{{font-size:16px;font-weight:700;margin:12px 0 2px}}.h4 .l,.h4 .r{{font-weight:700;color:#59636e;margin:8px 0 0}}
.li .l::before,.li .r::before{{content:"•";color:#8c959f;margin-right:6px}}.li .l:empty::before,.li .r:empty::before{{content:""}}.d1 .l,.d1 .r{{padding-left:1.6em}}.d2 .l,.d2 .r{{padding-left:3.2em}}.d3 .l,.d3 .r{{padding-left:4.8em}}
.eq .l,.eq .r{{color:#57606a}}.eq b{{color:#57606a}}
del{{color:#b31d28;background:#ffeef0;text-decoration:line-through;text-decoration-thickness:1.5px}}
ins{{color:#116329;background:#dafbe1;text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:3px}}
.chg .l{{background:#fff5f5}}.chg .r{{background:#f0fff4}}.del .l{{background:#fff5f5}}.ins .r{{background:#f0fff4}}
.row.marked .r,.row.marked .l{{outline:2px solid #ff8182;outline-offset:-2px}}
code{{background:#eff1f3;border-radius:5px;padding:0 4px;font-size:90%}}.lnk{{color:#0969da}}
.cbox{{grid-column:1/-1;padding:4px 0 8px 44px}}.cbox textarea{{width:100%;box-sizing:border-box;min-height:48px;font:13px/1.5 inherit;border:1px solid #d4a72c;border-radius:6px;padding:6px 8px;background:#fffbe6}}
body.stack .row{{grid-template-columns:34px 1fr 110px}}body.stack .eq .l,body.stack .ins .l,body.stack .del .r{{display:none}}
body.stack .chg .l{{grid-column:2}}body.stack .chg .r{{grid-column:2}}body.stack .chg .r::before{{content:"→ ";color:#8c959f}}body.stack .chg .act{{grid-row:1}}
body.focus .eq{{display:none}}body.focus .eq.ctx{{display:grid}}body.focus .eq.ctx .l,body.focus .eq.ctx .r{{color:#9aa3ad}}
.gap{{display:none;color:#8c959f;font-size:12px;text-align:center;padding:4px 0;border-top:1px dashed #d1d9e0;margin:4px 0}}body.focus .gap{{display:block}}
.foot{{margin-top:18px;padding-top:14px;border-top:1px solid #d1d9e0}}.foot textarea{{width:100%;box-sizing:border-box;border:1px solid #d1d9e0;border-radius:6px;padding:8px;font:13px/1.5 inherit}}
.foot .lbl{{display:block;font-weight:600;margin:10px 0 4px}}.foot .lbl .hint{{font-weight:400;font-size:12px;color:#59636e;margin-left:8px}}
#chc,#all{{min-height:56px}}#out{{min-height:160px;margin-top:8px;font-family:ui-monospace,Menlo,monospace;font-size:12px}}
.foot .btns{{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}}.foot .btns .sp{{flex:1}}
.foot .main{{font-size:14px;font-weight:600;padding:8px 18px;border-radius:6px;border:1px solid #1f883d;background:#1f883d;color:#fff}}
.foot #next{{font-size:14px;font-weight:600;padding:7px 14px;border-color:#54aeff;background:#ddf4ff;color:#0550ae}}
.foot .flow{{font-size:12px;color:#59636e;margin:8px 0 0}}#msg{{font-size:13px;font-weight:600;color:#1a7f37}}
.tabs .st.more{{background:#fff8c5;color:#7d4e00}}.tabs .st.applied{{background:#ddf4ff;color:#0550ae}}.tabs .st.upd{{background:#ffebe9;color:#a40e26}}
.row .why{{grid-column:2/4;font-size:12px;line-height:1.5;color:#7d4e00;background:#fff8e5;border-radius:4px;padding:3px 8px;margin:0 0 6px}}.row .why::before{{content:'理由: ';font-weight:600}}body.stack .row .why{{grid-column:2}}
{EDIT_CSS if EDIT else ''}
</style><div class="wrap">
<h1>{html.escape(path)} の{'編集ビュー' if EDIT else '変更履歴ビュー'}</h1>
<p class="note">{('左が元の文（' + html.escape(before_ref) + ' 時点）、右が案です。右の欄はそのまま書き換えられ、元の文との違いがその場で色で出ます（左の赤 = 消える部分、右の緑 = 足した部分）。行の「元の文」「案」ボタンで一度に戻せ、「コメント」で右の余白に一言書けます。') if EDIT else (html.escape(before_ref) + ' 時点（左）→ 現在（右）。<del>消した部分</del>は赤の取り消し線、<ins>足した部分</ins>は緑の下線。気になる行は「戻す」を押すか「コメント」で一言書いてください。')}章を見終えたら「この章の回答をコピー」でチャットに貼ってください。章ごとに送れば、こちらが反映している間に次の章を見られます。直すところがない章も送ると「送信済み」になります。</p>
<div class="bar"><span>変更 {stats["chg"]} 行 / 追加 {stats["ins"]} 行 / 削除 {stats["del"]} 行</span>
<button id="side" class="on">左右に並べる</button><button id="stack">1 列で重ねる</button>
<button id="allv" class="on">全文</button><button id="focus">変更箇所だけ</button><button id="reload" title="入力中の印とコメントは残ります">再読み込み</button><span class="sp"></span><span id="warn"></span><span id="sum"></span></div>
<div class="tabs" id="tabs"></div>
<div class="doc">{''.join(rows)}</div>
<div class="foot">
<label class="lbl" for="chc">この章へのコメント<span class="hint" id="chHint"></span></label>
<textarea id="chc" placeholder="この章全体への話（項目の並び、足したい行、など）"></textarea>
<label class="lbl" for="all">全体へのコメント<span class="hint">章によらない話。次に送る回答に 1 回だけ付き、送った後でページを作り直すと消えます</span><span class="hint" id="allst"></span></label>
<textarea id="all" placeholder="章によらない話があればここに"></textarea>
<div class="btns"><button class="main" id="go">この章の回答をコピー</button><button id="next" hidden></button><span id="msg"></span><span class="sp"></span><button id="goAll">送っていない章をまとめてコピー</button><button id="sel">全選択</button></div>
<p class="flow">章ごとに送ると、こちらが反映している間に次の章を見られます。送った後に印やコメントを変えた章はタブが「追加あり」になり、もう一度送ると前の回答を置き換えます。</p>
<textarea id="out" readonly placeholder="ここに回答が出ます（クリップボードにも入ります）。チャットに貼ってください"></textarea></div></div>
<script>
const TEXTS={json.dumps(texts,ensure_ascii=False)};
const CHAPTERS={json.dumps(list(dict.fromkeys(chapters)),ensure_ascii=False)};
const CH_HASH={json.dumps({c:hashlib.sha1(chr(2).join(v).encode()).hexdigest()[:12] for c,v in chsrc.items()},ensure_ascii=False)};
const DONE={json.dumps([next((c for c in dict.fromkeys(chapters) if norm(c)==norm(d)), d) for d in DONE],ensure_ascii=False)};
const EDIT={'true' if EDIT else 'false'};if(EDIT)document.body.classList.add('edit');
const KEY='redline:'+{json.dumps(os.path.abspath(out),ensure_ascii=False)};
/* ページを作った時刻。送った全体へのコメントは、ページが作り直されたら反映済みとみなして消す */
const BUILD={json.dumps(str(time.time_ns()))};let allBuild='';
const rows=[...document.querySelectorAll('.row')];
const B=id=>document.getElementById(id);
let curCh=null;
const NCH={{}};let chc={{}},sent={{}},allSent='';
const short=ch=>ch.replace(/^[^›]+› /,'');
function showCh(ch){{if(curCh!==null)chc[curCh]=B('chc').value;curCh=ch;B('chc').value=chc[ch]||'';B('chHint').textContent=`「${{short(ch)}}」の回答に付きます`;
  rows.forEach(r=>{{r.style.display=(r.dataset.ch===ch)?'':'none';}});
  /* 行コメントの欄は行の外にあるので、行と一緒に隠さないと別の章のコメントが残って見える */
  document.querySelectorAll('.cbox').forEach(c=>{{const t=TEXTS[c.dataset.for];c.style.display=(t&&t.ch===ch)?'':'none';}});
  document.querySelectorAll('.gap').forEach(g=>{{const nx=g.nextElementSibling;g.style.display=(nx&&nx.dataset.ch===ch)?'':'none';}});
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.ch===ch));
  /* 前の章の回答が残っていると貼り間違えるので、章を移ったら回答欄を空にする */
  B('out').value='';B('msg').textContent='';B('next').hidden=true;refresh();save();window.scrollTo({{top:0}});}}
(function(){{const tabs=B('tabs');CHAPTERS.forEach(ch=>{{const n=rows.filter(r=>r.dataset.ch===ch&&!r.classList.contains('eq')).length;NCH[ch]=n;if(!n&&ch==='（冒頭）')return;const b=document.createElement('button');b.dataset.ch=ch;b.innerHTML=`${{short(ch)}}<span class="c">${{n}}</span><span class="st" hidden></span>`;b.onclick=()=>showCh(ch);tabs.appendChild(b);}});}})();
rows.forEach((r,i)=>{{ if(!r.classList.contains('eq')) for(let k=Math.max(0,i-2);k<=Math.min(rows.length-1,i+2);k++) rows[k].classList.add('ctx'); }});
let prevq=null; rows.forEach(r=>{{ const c=r.classList.contains('eq')&&!r.classList.contains('ctx'); if(c&&!prevq){{ const g=document.createElement('div'); g.className='gap'; g.textContent='…'; r.before(g); }} prevq=c; }});
B('side').onclick=()=>{{document.body.classList.remove('stack');B('side').classList.add('on');B('stack').classList.remove('on');}};
B('stack').onclick=()=>{{document.body.classList.add('stack');B('stack').classList.add('on');B('side').classList.remove('on');}};
B('allv').onclick=()=>{{document.body.classList.remove('focus');B('allv').classList.add('on');B('focus').classList.remove('on');}};
B('focus').onclick=()=>{{document.body.classList.add('focus');B('focus').classList.add('on');B('allv').classList.remove('on');}};
const state={{}};
const marked=key=>{{const s=state[key];return !!s&&(s.rev||!!(s.c||'').trim()||s.t!==undefined);}};
{EDIT_JS if EDIT else ''}
function per(ch){{const ls=[];rows.forEach(r=>{{if(r.dataset.ch!==ch||!marked(r.dataset.key))return;const s=state[r.dataset.key],t=TEXTS[r.dataset.key];
    /* 編集モード: 案から直した行は「案 → 直した文」を行頭ごと出す。受け手はこの 1 行で置き換えればよい */
    if(EDIT&&s.t!==undefined){{const lab=s.t===t.ltn?'[元の文に戻す]':s.t===''?'[削除]':'[直した]';
      ls.push(`#${{t.n||'(削除行)'}} ${{lab}} ${{t.rp||t.lp||''}}${{s.t.replace(/\\n/g,' ⏎ ')}}`+(t.rt?`\\n    （案: ${{t.rt}}）`:'')+((s.c||'').trim()?`\\n    → ${{s.c.trim().replace(/\\n/g,' / ')}}`:''));return;}}
    ls.push(`#${{t.n||'(削除行)'}} ${{s.rev?'[戻す] ':''}}${{t.text}}`+((s.c||'').trim()?`\\n    → ${{s.c.trim().replace(/\\n/g,' / ')}}`:''));}});return ls;}}
const cmt=ch=>((ch===curCh?B('chc').value:chc[ch])||'').trim();
const touched=ch=>per(ch).length>0||!!cmt(ch);
const sig=ch=>per(ch).join('\\n')+'\\u0000'+cmt(ch);
const hashOf=ch=>CH_HASH[ch]||'';
/* 送った回答は、そのときの章の内容（CH_HASH）と一緒に覚える。作り直して内容が変わった章は「更新あり」になる */
const sentNow=ch=>sent[ch]&&sent[ch].hash===hashOf(ch)?sent[ch]:null;
const LBL={{todo:'未回答',wip:'入力中',ok:'送信済み',more:'追加あり',applied:'反映済み',upd:'更新あり'}};
const FIN=new Set(['ok','applied']);
function status(ch){{const s=sentNow(ch);if(s)return sig(ch)===s.sig?'ok':'more';
  if(DONE.includes(ch))return touched(ch)?'wip':'applied';
  if(sent[ch])return touched(ch)?'wip':'upd';
  return touched(ch)?'wip':'todo';}}
/* 回答が要る章 = 変更のある章 + 変更はないが印やコメントを付けた章 + 前に送った章 */
const need=()=>CHAPTERS.filter(ch=>NCH[ch]||touched(ch)||sent[ch]);
function refresh(){{const ns=need();document.querySelectorAll('.tabs button').forEach(b=>{{const ch=b.dataset.ch,st=b.querySelector('.st');st.hidden=!ns.includes(ch);if(st.hidden)return;const k=status(ch);st.className='st '+k;st.textContent=LBL[k];}});
  const rest=ns.filter(ch=>!FIN.has(status(ch)));B('warn').classList.toggle('ok',!rest.length);
  B('warn').textContent=rest.length?`回答待ちの章 ${{rest.length}} / ${{ns.length}}`:`全 ${{ns.length}} 章の回答がそろいました`;}}
/* 入力はブラウザに保存し、再読み込みや作り直したページでも引き継ぐ。行は data-sid で引き当てる */
function save(){{try{{const st={{}};rows.forEach(r=>{{const s=state[r.dataset.key];if(s&&(s.rev||(s.c||'').trim()||s.t!==undefined))st[r.dataset.sid]={{rev:!!s.rev,c:s.c||'',t:s.t}};}});
  if(curCh!==null)chc[curCh]=B('chc').value;
  localStorage.setItem(KEY,JSON.stringify({{st,chc,all:B('all').value,allSent,allBuild,sent,cur:curCh}}));}}catch(e){{}}}}
function restore(){{let d=null;try{{d=JSON.parse(localStorage.getItem(KEY)||'null');}}catch(e){{}}if(!d)return null;
  /* 送った後に内容が変わった章（更新あり）と反映済みの章は、前の印とコメントを読み込まない。反映済みの意見が残ると、新しい案と混ざって読みにくい */
  const stale=ch=>DONE.includes(ch)||!!(d.sent&&d.sent[ch]&&d.sent[ch].hash!==hashOf(ch));
  rows.forEach(r=>{{if(stale(r.dataset.ch))return;const v=d.st&&d.st[r.dataset.sid];if(!v)return;const key=r.dataset.key;state[key]={{rev:!!v.rev,c:v.c||''}};if(v.t!==undefined&&v.t!==null)state[key].t=v.t;
    if(v.rev){{r.classList.add('marked');const b=r.querySelector('[data-act="rev"]');if(b)b.classList.add('on');}}
    if((v.c||'').trim()){{const box=document.querySelector(`.cbox[data-for="${{key}}"]`);box.hidden=false;box.querySelector('textarea').value=v.c;r.classList.add('has-c');r.querySelector('[data-act="cmt"]').classList.add('on2');}}}});
  chc=Object.fromEntries(Object.entries(d.chc||{{}}).filter(([ch])=>!stale(ch)));sent=d.sent||{{}};allSent=d.allSent||'';allBuild=d.allBuild||'';B('all').value=d.all||'';
  /* 送ったままの全体へのコメントは、作り直したページでは読み込まない（反映済みの意見が残ると、次の回答に混ざって紛らわしい） */
  if(allSent&&B('all').value.trim()===allSent&&allBuild!==BUILD){{B('all').value='';allSent='';allBuild='';}}
  return d.cur||null;}}
function sum(){{const rv=Object.values(state).filter(s=>s.rev).length,ed=Object.values(state).filter(s=>s.t!==undefined).length,cm=Object.values(state).filter(s=>(s.c||'').trim()).length;B('sum').textContent=EDIT?`直した ${{ed}} 行 / コメント ${{cm}} 件`:`戻す ${{rv}} 件 / コメント ${{cm}} 件`;refresh();save();}}
document.querySelectorAll('.act button').forEach(b=>b.onclick=e=>{{
  const row=e.target.closest('.row'),key=row.dataset.key;state[key]=state[key]||{{}};
  if(e.target.dataset.act==='orig'||e.target.dataset.act==='prop'){{setText(row,e.target.dataset.act==='orig'?TEXTS[key].lt:TEXTS[key].rt);}}
  else if(e.target.dataset.act==='rev'){{state[key].rev=!state[key].rev;e.target.classList.toggle('on',state[key].rev);row.classList.toggle('marked',state[key].rev);}}
  else{{const box=document.querySelector(`.cbox[data-for="${{key}}"]`);box.hidden=!box.hidden;e.target.classList.toggle('on2',!box.hidden);if(!box.hidden)box.querySelector('textarea').focus();}}
  sum();}});
document.querySelectorAll('.cbox textarea').forEach(t=>t.oninput=()=>{{const key=t.closest('.cbox').dataset.for;state[key]=state[key]||{{}};state[key].c=t.value;(t.closest('.row')||t.closest('.cbox').previousElementSibling).classList.toggle('has-c',!!t.value.trim());sum();}});
/* 編集モード: 欄に案（または保存してあった直し）を入れ、書き換えるたびに差分を描き直す */
B('chc').oninput=()=>{{chc[curCh]=B('chc').value;refresh();save();}};
const allMark=()=>{{const v=B('all').value.trim();B('allst').textContent=v&&v===allSent?'（送信済み）':'';}};
B('all').oninput=()=>{{allMark();save();}};
/* 1 章分の回答。前に送った章をもう一度送るときは「置き換え」と書き、受け手が前の回答を捨てられるようにする */
function block(ch){{const ls=per(ch),c=cmt(ch);const tag=!sent[ch]?'':sentNow(ch)?'（再送。前に送ったこの章の回答と置き換え）':'（更新した案への回答。前に送ったこの章の回答と置き換え）';
  return [`[章: ${{ch}}]`+tag,...(ls.length?ls:['指摘なし']),...(c?[`[この章へのコメント] ${{c.replace(/\\n/g,' / ')}}`]:[])];}}
/* 末尾に進み具合を付ける。受け手は「まだ続きが来るのか、これで全部か」を回答だけで判断できる */
function progressLine(){{const ns=need(),rest=ns.filter(ch=>!FIN.has(status(ch)));
  return rest.length?`（全 ${{ns.length}} 章のうち ${{ns.length-rest.length}} 章が回答済み。まだ: ${{rest.map(short).join(' / ')}}）`:`（全 ${{ns.length}} 章の回答がそろいました）`;}}
/* 画面の状態は先に更新し、クリップボードへのコピーは後から試す（file:// では許可待ちで止まることがあるので 0.8 秒で諦めて選択状態にする） */
function copy(v){{const fb=()=>{{const t=B('out');t.focus();t.select();let ok=false;try{{ok=document.execCommand('copy');}}catch(_){{}}B('msg').textContent=ok?'コピーしました。チャットに貼ってください':'下の欄を全選択してコピーしてください';}};
  B('msg').textContent='コピーしています…';if(!navigator.clipboard){{fb();return;}}
  Promise.race([navigator.clipboard.writeText(v),new Promise((_,rej)=>setTimeout(()=>rej(0),800))]).then(()=>{{B('msg').textContent='コピーしました。チャットに貼ってください';}}).catch(fb);}}
function emit(lines){{const a=B('all').value.trim();if(a&&a!==allSent){{lines.push('','[全体へのコメント]',a);allSent=a;allBuild=BUILD;}}allMark();
  while(lines.length&&lines[lines.length-1]==='')lines.pop();
  lines.push('',progressLine());const v=lines.join('\\n').trim();B('out').value=v;copy(v);save();}}
B('go').onclick=()=>{{chc[curCh]=B('chc').value;const lines=block(curCh);sent[curCh]={{sig:sig(curCh),hash:hashOf(curCh)}};emit(lines);refresh();save();
  const nx=need().find(ch=>!FIN.has(status(ch)));B('next').hidden=!nx;
  if(nx){{B('next').textContent=`次の章へ: ${{short(nx)}} →`;B('next').onclick=()=>showCh(nx);}}}};
B('goAll').onclick=()=>{{chc[curCh]=B('chc').value;const lines=[];
  need().filter(ch=>!FIN.has(status(ch))).forEach(ch=>{{const k=status(ch);if(k==='todo'||k==='upd'){{lines.push(`[章: ${{ch}}]`,k==='todo'?'未回答（この章はまだ見ていない）':'未回答（更新した案をまだ見ていない）','');return;}}lines.push(...block(ch),'');sent[ch]={{sig:sig(ch),hash:hashOf(ch)}};}});
  if(!lines.length)lines.push('（回答待ちの章はありません）');emit(lines);refresh();save();B('next').hidden=true;}};
/* 作り直したページを読み込む。入力は保存してあるので消えない。自動では読み込み直さない */
B('reload').onclick=()=>{{save();location.reload();}};
B('sel').onclick=()=>{{const t=B('out');t.select();t.setSelectionRange(0,t.value.length);}};
const RESUME=restore();allMark();if(EDIT)initEdit();sum();
const START={json.dumps(next((c for c in dict.fromkeys(chapters) if norm(c)==norm(start)), start) if start else '',ensure_ascii=False)};showCh(RESUME&&CHAPTERS.includes(RESUME)?RESUME:CHAPTERS.includes(START)?START:CHAPTERS.find(c=>c!=='（冒頭）')||CHAPTERS[0]);
</script></html>'''
io.open(out,'w',encoding='utf-8').write(page); print(f'変更 {stats["chg"]} / 追加 {stats["ins"]} / 削除 {stats["del"]} 行 → {out}')
