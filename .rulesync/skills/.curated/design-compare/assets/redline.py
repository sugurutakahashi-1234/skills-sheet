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
                ca,ta=cls_of(a[ia]); add('del',ca,f'<del>{md_inline(ta)}</del>','',None,ta); stats['del']+=1
            elif kind=='ins':
                lb=b[ib]; enter(lb); cb,tb=cls_of(lb); add('ins',cb,'',f'<ins>{md_inline(tb)}</ins>',j1+ib+1,tb); stats['ins']+=1
            else:
                ca,ta=cls_of(a[ia]); enter(b[ib]); cb,tb=cls_of(b[ib])
                # 太字の項目名どうしは ** を外して比べる（差分で ** が分断されると太字にならない）
                bold=all(t.startswith('**') and t.endswith('**') and len(t)>4 for t in (ta,tb))
                da,db=char_diff(ta[2:-2],tb[2:-2]) if bold else char_diff(ta,tb)
                if bold: da,db=f'<b>{da}</b>',f'<b>{db}</b>'
                add('chg',cb,da,db,j1+ib+1,tb); stats['chg']+=1

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
.tabs .st.more{{background:#fff8c5;color:#7d4e00}}
</style><div class="wrap">
<h1>{html.escape(path)} の変更履歴ビュー</h1>
<p class="note">{html.escape(before_ref)} 時点（左）→ 現在（右）。<del>消した部分</del>は赤の取り消し線、<ins>足した部分</ins>は緑の下線。章のタブで区切って見て、気になる行は「戻す」を押すか「コメント」で一言書き、章を見終えたら「この章の回答をコピー」でチャットに貼ってください。章ごとに送れば、こちらが反映している間に次の章を見られます。直すところがない章も送ると「送信済み」になります。</p>
<div class="bar"><span>変更 {stats["chg"]} 行 / 追加 {stats["ins"]} 行 / 削除 {stats["del"]} 行</span>
<button id="side" class="on">左右に並べる</button><button id="stack">1 列で重ねる</button>
<button id="allv" class="on">全文</button><button id="focus">変更箇所だけ</button><span class="sp"></span><span id="warn"></span><span id="sum"></span></div>
<div class="tabs" id="tabs"></div>
<div class="doc">{''.join(rows)}</div>
<div class="foot">
<label class="lbl" for="chc">この章へのコメント<span class="hint" id="chHint"></span></label>
<textarea id="chc" placeholder="この章全体への話（項目の並び、足したい行、など）"></textarea>
<label class="lbl" for="all">全体へのコメント<span class="hint">章によらない話。次に送る回答に 1 回だけ付きます</span></label>
<textarea id="all" placeholder="章によらない話があればここに"></textarea>
<div class="btns"><button class="main" id="go">この章の回答をコピー</button><button id="next" hidden></button><span id="msg"></span><span class="sp"></span><button id="goAll">送っていない章をまとめてコピー</button><button id="sel">全選択</button></div>
<p class="flow">章ごとに送ると、こちらが反映している間に次の章を見られます。送った後に印やコメントを変えた章はタブが「追加あり」になり、もう一度送ると前の回答を置き換えます。</p>
<textarea id="out" readonly placeholder="ここに回答が出ます（クリップボードにも入ります）。チャットに貼ってください"></textarea></div></div>
<script>
const TEXTS={json.dumps(texts,ensure_ascii=False)};
const CHAPTERS={json.dumps(list(dict.fromkeys(chapters)),ensure_ascii=False)};
const rows=[...document.querySelectorAll('.row')];
const B=id=>document.getElementById(id);
let curCh=null;
const NCH={{}},chc={{}},sentSig={{}};let allSent='';
const short=ch=>ch.replace(/^[^›]+› /,'');
function showCh(ch){{if(curCh!==null)chc[curCh]=B('chc').value;curCh=ch;B('chc').value=chc[ch]||'';B('chHint').textContent=`「${{short(ch)}}」の回答に付きます`;
  rows.forEach(r=>{{r.style.display=(r.dataset.ch===ch)?'':'none';}});
  document.querySelectorAll('.gap').forEach(g=>{{const nx=g.nextElementSibling;g.style.display=(nx&&nx.dataset.ch===ch)?'':'none';}});
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.ch===ch));B('msg').textContent='';B('next').hidden=true;refresh();window.scrollTo({{top:0}});}}
(function(){{const tabs=B('tabs');CHAPTERS.forEach(ch=>{{const n=rows.filter(r=>r.dataset.ch===ch&&!r.classList.contains('eq')).length;NCH[ch]=n;if(!n&&ch==='（冒頭）')return;const b=document.createElement('button');b.dataset.ch=ch;b.innerHTML=`${{short(ch)}}<span class="c">${{n}}</span><span class="st" hidden></span>`;b.onclick=()=>showCh(ch);tabs.appendChild(b);}});}})();
rows.forEach((r,i)=>{{ if(!r.classList.contains('eq')) for(let k=Math.max(0,i-2);k<=Math.min(rows.length-1,i+2);k++) rows[k].classList.add('ctx'); }});
let prevq=null; rows.forEach(r=>{{ const c=r.classList.contains('eq')&&!r.classList.contains('ctx'); if(c&&!prevq){{ const g=document.createElement('div'); g.className='gap'; g.textContent='…'; r.before(g); }} prevq=c; }});
B('side').onclick=()=>{{document.body.classList.remove('stack');B('side').classList.add('on');B('stack').classList.remove('on');}};
B('stack').onclick=()=>{{document.body.classList.add('stack');B('stack').classList.add('on');B('side').classList.remove('on');}};
B('allv').onclick=()=>{{document.body.classList.remove('focus');B('allv').classList.add('on');B('focus').classList.remove('on');}};
B('focus').onclick=()=>{{document.body.classList.add('focus');B('focus').classList.add('on');B('allv').classList.remove('on');}};
const state={{}};
const marked=key=>{{const s=state[key];return !!s&&(s.rev||!!(s.c||'').trim());}};
function per(ch){{const ls=[];rows.forEach(r=>{{if(r.dataset.ch!==ch||!marked(r.dataset.key))return;const s=state[r.dataset.key],t=TEXTS[r.dataset.key];
    ls.push(`#${{t.n||'(削除行)'}} ${{s.rev?'[戻す] ':''}}${{t.text}}`+((s.c||'').trim()?`\\n    → ${{s.c.trim().replace(/\\n/g,' / ')}}`:''));}});return ls;}}
const cmt=ch=>((ch===curCh?B('chc').value:chc[ch])||'').trim();
const touched=ch=>per(ch).length>0||!!cmt(ch);
const sig=ch=>per(ch).join('\\n')+'\\u0000'+cmt(ch);
/* 回答が要る章 = 変更のある章 + 変更はないが印やコメントを付けた章 */
const need=()=>CHAPTERS.filter(ch=>NCH[ch]||touched(ch)||sentSig[ch]!==undefined);
/* 章の状態。未回答: 触れていない / 入力中: 印はあるが送っていない / 送信済み / 追加あり: 送った後に変えた */
const LBL={{todo:'未回答',wip:'入力中',ok:'送信済み',more:'追加あり'}};
function status(ch){{if(sentSig[ch]===undefined)return touched(ch)?'wip':'todo';return sig(ch)===sentSig[ch]?'ok':'more';}}
function refresh(){{const ns=need();document.querySelectorAll('.tabs button').forEach(b=>{{const ch=b.dataset.ch,st=b.querySelector('.st');st.hidden=!ns.includes(ch);if(st.hidden)return;const k=status(ch);st.className='st '+k;st.textContent=LBL[k];}});
  const rest=ns.filter(ch=>status(ch)!=='ok');B('warn').classList.toggle('ok',!rest.length);
  B('warn').textContent=rest.length?`送っていない章 ${{rest.length}} / ${{ns.length}}`:`全 ${{ns.length}} 章を送りました`;}}
function sum(){{const rv=Object.values(state).filter(s=>s.rev).length,cm=Object.values(state).filter(s=>(s.c||'').trim()).length;B('sum').textContent=`戻す ${{rv}} 件 / コメント ${{cm}} 件`;refresh();}}
document.querySelectorAll('.act button').forEach(b=>b.onclick=e=>{{
  const row=e.target.closest('.row'),key=row.dataset.key;state[key]=state[key]||{{}};
  if(e.target.dataset.act==='rev'){{state[key].rev=!state[key].rev;e.target.classList.toggle('on',state[key].rev);row.classList.toggle('marked',state[key].rev);}}
  else{{const box=document.querySelector(`.cbox[data-for="${{key}}"]`);box.hidden=!box.hidden;e.target.classList.toggle('on2',!box.hidden);if(!box.hidden)box.querySelector('textarea').focus();}}
  sum();}});
document.querySelectorAll('.cbox textarea').forEach(t=>t.oninput=()=>{{const key=t.closest('.cbox').dataset.for;state[key]=state[key]||{{}};state[key].c=t.value;t.closest('.cbox').previousElementSibling.classList.toggle('has-c',!!t.value.trim());sum();}});
B('chc').oninput=()=>{{chc[curCh]=B('chc').value;refresh();}};
/* 1 章分の回答。前に送った章をもう一度送るときは「置き換え」と書き、受け手が前の回答を捨てられるようにする */
function block(ch){{const ls=per(ch),c=cmt(ch);return [`[章: ${{ch}}]`+(sentSig[ch]!==undefined?'（再送。前に送ったこの章の回答と置き換え）':''),...(ls.length?ls:['指摘なし']),...(c?[`[この章へのコメント] ${{c.replace(/\\n/g,' / ')}}`]:[])];}}
/* 末尾に進み具合を付ける。受け手は「まだ続きが来るのか、これで全部か」を回答だけで判断できる */
function progressLine(){{const ns=need(),rest=ns.filter(ch=>status(ch)!=='ok');
  return rest.length?`（全 ${{ns.length}} 章のうち ${{ns.length-rest.length}} 章を送信済み。まだ: ${{rest.map(short).join(' / ')}}）`:`（全 ${{ns.length}} 章の回答がそろいました）`;}}
/* 画面の状態は先に更新し、クリップボードへのコピーは後から試す（file:// では許可待ちで止まることがあるので 0.8 秒で諦めて選択状態にする） */
function copy(v){{const fb=()=>{{const t=B('out');t.focus();t.select();let ok=false;try{{ok=document.execCommand('copy');}}catch(_){{}}B('msg').textContent=ok?'コピーしました。チャットに貼ってください':'下の欄を全選択してコピーしてください';}};
  B('msg').textContent='コピーしています…';if(!navigator.clipboard){{fb();return;}}
  Promise.race([navigator.clipboard.writeText(v),new Promise((_,rej)=>setTimeout(()=>rej(0),800))]).then(()=>{{B('msg').textContent='コピーしました。チャットに貼ってください';}}).catch(fb);}}
function emit(lines){{const a=B('all').value.trim();if(a&&a!==allSent){{lines.push('','[全体へのコメント]',a);allSent=a;}}
  while(lines.length&&lines[lines.length-1]==='')lines.pop();
  lines.push('',progressLine());const v=lines.join('\\n').trim();B('out').value=v;copy(v);}}
B('go').onclick=()=>{{chc[curCh]=B('chc').value;const lines=block(curCh);sentSig[curCh]=sig(curCh);emit(lines);refresh();
  const nx=need().find(ch=>status(ch)!=='ok');B('next').hidden=!nx;
  if(nx){{B('next').textContent=`次の章へ: ${{short(nx)}} →`;B('next').onclick=()=>showCh(nx);}}}};
B('goAll').onclick=()=>{{chc[curCh]=B('chc').value;const lines=[];
  need().filter(ch=>status(ch)!=='ok').forEach(ch=>{{if(status(ch)==='todo'){{lines.push(`[章: ${{ch}}]`,'未回答（この章はまだ見ていない）','');return;}}lines.push(...block(ch),'');sentSig[ch]=sig(ch);}});
  if(!lines.length)lines.push('（送っていない章はありません）');emit(lines);refresh();B('next').hidden=true;}};
B('sel').onclick=()=>{{const t=B('out');t.select();t.setSelectionRange(0,t.value.length);}};
sum();
const START={json.dumps(start,ensure_ascii=False)};showCh(CHAPTERS.includes(START)?START:CHAPTERS.find(c=>c!=='（冒頭）')||CHAPTERS[0]);
</script></html>'''
io.open(out,'w',encoding='utf-8').write(page); print(f'変更 {stats["chg"]} / 追加 {stats["ins"]} / 削除 {stats["del"]} 行 → {out}')
