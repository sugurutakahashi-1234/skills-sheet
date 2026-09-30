#!/usr/bin/env python3
"""変更履歴ビュー: ファイルの before / after を 1 本の文書として並べ、削除を赤の取り消し線・追加を緑の下線で示す。
行ごとに「戻す」とコメントを付け、章ごとに回答をまとめてコピーできる。

使い方:
  python3 redline.py <repo> <file> <before_ref> <out.html> [開始章] [###で章を割るH2名,…]
  例: python3 redline.py . README.md HEAD~5 /tmp/redline.html "案件詳細 › [No.11] …" 案件詳細

  before_ref は git のリビジョン。章は `## ` 見出しごと。第 6 引数に H2 名を渡すと、その H2 の配下だけ `### ` でさらに割る。
"""
import sys, io, re, html, difflib, subprocess, json, os
if len(sys.argv) < 5:
    print(__doc__); sys.exit(1)
repo, path, before_ref, out = sys.argv[1:5]
start = sys.argv[5] if len(sys.argv) > 5 else ''
split_h3 = set(sys.argv[6].split(',')) if len(sys.argv) > 6 else set()
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
def char_diff(a, b):
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False); oa=[]; ob=[]
    for op,i1,i2,j1,j2 in sm.get_opcodes():
        if op=='equal': oa.append(md_inline(a[i1:i2])); ob.append(md_inline(b[j1:j2]))
        elif op=='delete': oa.append(f'<del>{md_inline(a[i1:i2])}</del>')
        elif op=='insert': ob.append(f'<ins>{md_inline(b[j1:j2])}</ins>')
        else: oa.append(f'<del>{md_inline(a[i1:i2])}</del>'); ob.append(f'<ins>{md_inline(b[j1:j2])}</ins>')
    return ''.join(oa), ''.join(ob)

rows=[]; stats={'del':0,'ins':0,'chg':0}; texts={}
CH=['（冒頭）']; H2=['']; chapters=['（冒頭）']
def chapter_of(line):
    if line.startswith('## '): H2[0]=line[3:].strip(); return H2[0]
    m=re.match(r'^### (.*)$', line)
    if m and H2[0] in split_h3: return f'{H2[0]} › {m.group(1).strip()}'
    return None
def enter(line):
    ch=chapter_of(line)
    if ch: CH[0]=ch; chapters.append(ch)
def add(kind, cls, left, right, n, plain):
    if cls=='raw': return
    key=f'r{len(rows)}'; texts[key]={'n':n,'kind':kind,'text':plain,'ch':CH[0]}
    act=('<button data-act="rev">戻す</button>' if kind!='eq' else '')+'<button data-act="cmt">コメント</button>'
    rows.append(f'<div class="row {kind} {cls}" data-key="{key}" data-ch="{html.escape(CH[0])}"><span class="n">{n or ""}</span><span class="l">{left}</span><span class="r">{right}</span><span class="act">{act}</span></div><div class="cbox" data-for="{key}" hidden><textarea placeholder="この行へのコメント（戻す理由、別の言い方、など）"></textarea></div>')
sm = difflib.SequenceMatcher(None, old, new, autojunk=False)
for op,i1,i2,j1,j2 in sm.get_opcodes():
    if op=='equal':
        for k in range(j1,j2):
            enter(new[k]); c,t=cls_of(new[k]); h=md_inline(t); add('eq',c,h,h,k+1,t)
    elif op=='delete':
        for k in range(i1,i2):
            c,t=cls_of(old[k]); add('del',c,f'<del>{md_inline(t)}</del>','',None,t); stats['del']+=1
    elif op=='insert':
        for k in range(j1,j2):
            enter(new[k]); c,t=cls_of(new[k]); add('ins',c,'',f'<ins>{md_inline(t)}</ins>',k+1,t); stats['ins']+=1
    else:
        a=old[i1:i2]; b=new[j1:j2]; pairs=[]; used=set()
        for ia,la in enumerate(a):
            best=None; bs=0.0
            for ib,lb in enumerate(b):
                if ib in used: continue
                r=difflib.SequenceMatcher(None,la,lb).ratio()
                if r>bs: bs,best=r,ib
            if best is not None and bs>=0.45: pairs.append((ia,best)); used.add(best)
            else: pairs.append((ia,None))
        for ia,ib in pairs:
            ca,ta=cls_of(a[ia])
            if ib is None: add('del',ca,f'<del>{md_inline(ta)}</del>','',None,ta); stats['del']+=1
            else:
                enter(b[ib]); cb,tb=cls_of(b[ib]); da,db=char_diff(ta,tb); add('chg',cb,da,db,j1+ib+1,tb); stats['chg']+=1
        for ib,lb in enumerate(b):
            if ib not in used:
                enter(lb); cb,tb=cls_of(lb); add('ins',cb,'',f'<ins>{md_inline(tb)}</ins>',j1+ib+1,tb); stats['ins']+=1

page=f'''<!doctype html><html lang="ja"><meta charset="utf-8"><title>{html.escape(path)} の変更履歴ビュー</title>
<style>
:root{{color-scheme:light}}body{{margin:0;padding:24px 24px 40px;background:#f6f8fa;color:#1f2328;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}}
.wrap{{max-width:1400px;margin:0 auto}}h1{{font-size:20px;margin:0 0 6px}}.note{{font-size:13px;color:#59636e;margin:0 0 12px}}
.bar{{position:sticky;top:0;z-index:5;background:#f6f8fa;padding:8px 0;border-bottom:1px solid #d1d9e0;margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}}
.bar button,.act button,.foot button{{font-size:12px;padding:3px 10px;border:1px solid #d1d9e0;border-radius:6px;background:#fff;cursor:pointer;color:#1f2328}}
.bar button.on{{background:#ddf4ff;border-color:#54aeff}}.bar .sp{{flex:1}}
.tabs{{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}}.tabs button{{font-size:13px;padding:5px 12px;border:1px solid #d1d9e0;border-radius:999px;background:#fff;cursor:pointer}}.tabs button.on{{background:#1f2328;color:#fff;border-color:#1f2328}}.tabs button .c{{opacity:.6;font-size:11px;margin-left:4px}}
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
.foot{{margin-top:18px;padding-top:14px;border-top:1px solid #d1d9e0}}.foot textarea{{width:100%;box-sizing:border-box;border:1px solid #d1d9e0;border-radius:6px;padding:8px;font:13px/1.5 inherit}}#all{{min-height:60px;margin:6px 0 10px}}#out{{min-height:160px;margin-top:8px;font-family:ui-monospace,Menlo,monospace;font-size:12px}}
.foot .main{{font-size:14px;font-weight:600;padding:8px 18px;border-radius:6px;border:1px solid #1f883d;background:#1f883d;color:#fff}}
</style><div class="wrap">
<h1>{html.escape(path)} の変更履歴ビュー</h1>
<p class="note">{html.escape(before_ref)} 時点（左）→ 現在（右）。<del>消した部分</del>は赤の取り消し線、<ins>足した部分</ins>は緑の下線。章のタブで区切って見て、気になる行は「戻す」を押すか「コメント」で一言書き、章ごとに「この章の回答をまとめる」を押してください。</p>
<div class="bar"><span>変更 {stats["chg"]} 行 / 追加 {stats["ins"]} 行 / 削除 {stats["del"]} 行</span>
<button id="side" class="on">左右に並べる</button><button id="stack">1 列で重ねる</button>
<button id="allv" class="on">全文</button><button id="focus">変更箇所だけ</button><span class="sp"></span><span id="sum"></span></div>
<div class="tabs" id="tabs"></div>
<div class="doc">{''.join(rows)}</div>
<div class="foot"><b>全体へのコメント</b><textarea id="all" placeholder="個別の行によらない話があればここに"></textarea>
<button class="main" id="go">この章の回答をまとめる</button> <button id="goAll">全章まとめて</button> <button id="copy">クリップボードにコピー</button> <button id="sel">全選択</button>
<textarea id="out" readonly placeholder="ここに回答が出ます。コピーしてチャットに貼ってください"></textarea></div></div>
<script>
const TEXTS={json.dumps(texts,ensure_ascii=False)};
const CHAPTERS={json.dumps(list(dict.fromkeys(chapters)),ensure_ascii=False)};
const rows=[...document.querySelectorAll('.row')];
const B=id=>document.getElementById(id);
let curCh=null;
function showCh(ch){{curCh=ch;rows.forEach(r=>{{r.style.display=(r.dataset.ch===ch)?'':'none';}});
  document.querySelectorAll('.gap').forEach(g=>{{const nx=g.nextElementSibling;g.style.display=(nx&&nx.dataset.ch===ch)?'':'none';}});
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.ch===ch));window.scrollTo({{top:0}});}}
(function(){{const tabs=B('tabs');CHAPTERS.forEach(ch=>{{const n=rows.filter(r=>r.dataset.ch===ch&&!r.classList.contains('eq')).length;if(!n&&ch==='（冒頭）')return;const b=document.createElement('button');b.dataset.ch=ch;b.innerHTML=`${{ch.replace(/^[^›]+› /,'')}}<span class="c">${{n}}</span>`;b.onclick=()=>showCh(ch);tabs.appendChild(b);}});}})();
rows.forEach((r,i)=>{{ if(!r.classList.contains('eq')) for(let k=Math.max(0,i-2);k<=Math.min(rows.length-1,i+2);k++) rows[k].classList.add('ctx'); }});
let prevq=null; rows.forEach(r=>{{ const c=r.classList.contains('eq')&&!r.classList.contains('ctx'); if(c&&!prevq){{ const g=document.createElement('div'); g.className='gap'; g.textContent='…'; r.before(g); }} prevq=c; }});
B('side').onclick=()=>{{document.body.classList.remove('stack');B('side').classList.add('on');B('stack').classList.remove('on');}};
B('stack').onclick=()=>{{document.body.classList.add('stack');B('stack').classList.add('on');B('side').classList.remove('on');}};
B('allv').onclick=()=>{{document.body.classList.remove('focus');B('allv').classList.add('on');B('focus').classList.remove('on');}};
B('focus').onclick=()=>{{document.body.classList.add('focus');B('focus').classList.add('on');B('allv').classList.remove('on');}};
const state={{}};
function sum(){{const rv=Object.values(state).filter(s=>s.rev).length,cm=Object.values(state).filter(s=>(s.c||'').trim()).length;B('sum').textContent=`戻す ${{rv}} 件 / コメント ${{cm}} 件`;}}
document.querySelectorAll('.act button').forEach(b=>b.onclick=e=>{{
  const row=e.target.closest('.row'),key=row.dataset.key;state[key]=state[key]||{{}};
  if(e.target.dataset.act==='rev'){{state[key].rev=!state[key].rev;e.target.classList.toggle('on',state[key].rev);row.classList.toggle('marked',state[key].rev);}}
  else{{const box=document.querySelector(`.cbox[data-for="${{key}}"]`);box.hidden=!box.hidden;e.target.classList.toggle('on2',!box.hidden);if(!box.hidden)box.querySelector('textarea').focus();}}
  sum();}});
document.querySelectorAll('.cbox textarea').forEach(t=>t.oninput=()=>{{const key=t.closest('.cbox').dataset.for;state[key]=state[key]||{{}};state[key].c=t.value;t.closest('.cbox').previousElementSibling.classList.toggle('has-c',!!t.value.trim());sum();}});
function build(all){{
  const lines=[];
  rows.forEach(r=>{{if(!all&&r.dataset.ch!==curCh)return;const key=r.dataset.key,s=state[key];if(!s||(!s.rev&&!(s.c||'').trim()))return;const t=TEXTS[key];
    lines.push(`#${{t.n||'(削除行)'}} ${{s.rev?'[戻す] ':''}}${{t.text}}`+((s.c||'').trim()?`\\n    → ${{s.c.trim().replace(/\\n/g,' / ')}}`:''));}});
  const allc=B('all').value.trim();if(allc)lines.push(`\\n[全体へのコメント]\\n${{allc}}`);
  if(!all)lines.unshift(`[章: ${{curCh}}]`);
  B('out').value=lines.length>1||all?lines.join('\\n'):'（戻す指定もコメントもありません）';return B('out').value;}}
B('go').onclick=()=>build(false);B('goAll').onclick=()=>build(true);
B('copy').onclick=async()=>{{const v=build(false);try{{await navigator.clipboard.writeText(v);B('copy').textContent='コピーしました';setTimeout(()=>B('copy').textContent='クリップボードにコピー',1500);}}catch(e){{B('out').select();document.execCommand('copy');B('copy').textContent='コピーしました（選択して）';}}}};
B('sel').onclick=()=>{{const t=B('out');t.select();t.setSelectionRange(0,t.value.length);}};
sum();
const START={json.dumps(start,ensure_ascii=False)};showCh(CHAPTERS.includes(START)?START:CHAPTERS.find(c=>c!=='（冒頭）')||CHAPTERS[0]);
</script></html>'''
io.open(out,'w',encoding='utf-8').write(page); print(f'変更 {stats["chg"]} / 追加 {stats["ins"]} / 削除 {stats["del"]} 行 → {out}')
