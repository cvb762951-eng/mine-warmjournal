# -*- coding: utf-8 -*-
"""1.1.60 (161)：① 修桌面名字（title_activity_main）② 把开屏补成预览那套完整版"""
import io, os, re

CLONE = "C:/Users/cvb/Documents/ChatGPT/.mine-gh-publish"
rd = lambda p: io.open(os.path.join(CLONE, p), encoding="utf-8", newline="").read()
wr = lambda p, s: io.open(os.path.join(CLONE, p), "w", encoding="utf-8", newline="").write(s)

# ── ① 名字：启动 Activity 的 label 也要改（它盖过 application 的）─────────
sp = "android/app/src/main/res/values/strings.xml"
x = rd(sp)
x2 = re.sub(r'(<string name="title_activity_main">)[^<]*(</string>)', r'\g<1>Nook\g<2>', x)
wr(sp, x2)
print("① 名字：title_activity_main =", "Nook" if x2 != x else "未变(检查)")

# ── ② 开屏：整块替换成完整版 ────────────────────────────────────────
BLOCK = r'''<style id="nook-splash-css">
#nook-splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;
  justify-content:center;font-family:'LXGW WenKai Screen R','Noto Serif SC',serif;
  --k:#1C1A17; --k2:#3A3025; --p:#C0442C; --p2:#C0703C; --paper:#F7F3EA;
  --glowA:rgba(255,214,150,.85); --glowB:rgba(255,190,120,.32);
  background:var(--paper); transition:background .72s ease}
html[data-theme="plain"] #nook-splash{--k:#1B2A3E; --k2:#2F4E7E; --p:#3E6FBE; --p2:#6E93CC;
  --paper:#EEF3FA; --glowA:rgba(198,220,255,.88); --glowB:rgba(150,186,240,.34)}
#nook-splash .mo{font-size:13.5px;letter-spacing:.34em;text-indent:.34em;color:var(--k2);opacity:0;
  animation:nkMo .62s ease .1s both}
#nook-splash svg{width:190px;height:190px;display:block}
#nook-splash .dnum{font-family:'LXGW WenKai Screen R','Noto Serif SC',serif;
  transform-box:view-box;transform-origin:60px 60px;
  animation:nkNum .62s cubic-bezier(.3,0,.25,1) .2s both, nkCaught .74s cubic-bezier(.3,.9,.3,1) 1.2s both}
#nook-splash .pen{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:2000;stroke-dashoffset:2000}
#nook-splash .p1{stroke:var(--k);stroke-width:5.1;animation:nkPen .92s cubic-bezier(.34,.08,.24,1) .36s both}
#nook-splash .p2{stroke:var(--k);stroke-width:3.4;animation:nkPen .84s cubic-bezier(.36,.08,.24,1) .44s both}
#nook-splash .p3{stroke:var(--p2);stroke-width:2.4;animation:nkPen .42s cubic-bezier(.4,0,.3,1) 1.06s both}
#nook-splash .brand{font-size:30px;letter-spacing:.26em;text-indent:.26em;color:var(--k);line-height:1;margin-top:6px}
#nook-splash .tag{font-size:12.5px;letter-spacing:.36em;text-indent:.36em;margin-top:11px;color:var(--p)}
#nook-splash .brand span,#nook-splash .tag span{display:inline-block;opacity:0}
#nook-splash .words{position:relative;z-index:2}
#nook-splash .mk{position:relative;z-index:2}
/* 波纹 + 暖光：按下去那一下的爆发感（和预览同一套数值） */
#nook-splash .burst,#nook-splash .glow{position:absolute;left:50%;top:50%;border-radius:50%;pointer-events:none;opacity:0}
#nook-splash .burst{width:190px;height:190px;margin:-95px 0 0 -95px;border:2px solid var(--p)}
#nook-splash .b2{border-width:1.4px;border-color:var(--p2)}
#nook-splash .b3{border-width:1px;border-color:var(--glowB)}
#nook-splash .glow{width:214px;height:214px;margin:-107px 0 0 -107px;
  background:radial-gradient(circle,var(--glowA),var(--glowB) 45%,rgba(255,190,120,0) 70%)}
@keyframes nkMo{0%{opacity:0;letter-spacing:.6em}100%{opacity:.62;letter-spacing:.34em}}
@keyframes nkNum{0%{opacity:0}100%{opacity:1}}
@keyframes nkCaught{0%{transform:rotate(-5deg) scale(1)}24%{transform:rotate(-3.4deg) scale(1.02,.965)}
  52%{transform:rotate(-1.5deg) scale(1.045,1.035)}100%{transform:rotate(-5deg) scale(1)}}
@keyframes nkPen{0%{stroke-dashoffset:2000}100%{stroke-dashoffset:0}}
@keyframes nkChar{0%{opacity:0;transform:translateY(4px)}100%{opacity:1;transform:none}}
@keyframes nkBurst{0%{opacity:0;transform:scale(.86)}18%{opacity:.9}100%{opacity:0;transform:scale(2.15)}}
@keyframes nkGlow{0%{opacity:0;transform:scale(.6)}22%{opacity:1}100%{opacity:0;transform:scale(1.5)}}
@keyframes nkMarkOut{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.028)}}
@keyframes nkWordsOut{0%{opacity:1}100%{opacity:0;transform:translateY(-7px)}}
#nook-splash .b1{animation:nkBurst .76s cubic-bezier(.2,.7,.3,1) 1.20s both}
#nook-splash .b2{animation:nkBurst .82s cubic-bezier(.2,.7,.3,1) 1.32s both}
#nook-splash .b3{animation:nkBurst .88s cubic-bezier(.2,.7,.3,1) 1.44s both}
#nook-splash .glow{animation:nkGlow .70s cubic-bezier(.2,.8,.3,1) 1.20s both}
/* 交棒：2.48s 背景先透明（主界面就露出来了），2.48s 标记退，3.06s 两行字才退 */
#nook-splash .mk{animation:nkMarkOut .68s ease 2.48s both}
#nook-splash .words{animation:nkWordsOut .62s ease 3.06s both}
#nook-splash.is-out{background:transparent!important}
@media (prefers-reduced-motion:reduce){#nook-splash{display:none}}
</style>
<div id="nook-splash" aria-hidden="true">
  <span class="glow"></span><span class="burst b1"></span><span class="burst b2"></span><span class="burst b3"></span>
  <div class="mk">
    <div class="mo" id="nkMo"></div>
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <text class="dnum" x="61.6" y="63.8" text-anchor="middle" dominant-baseline="central" font-size="44"
        transform="rotate(-5 60 60)" fill="#FFFFFF" fill-opacity=".62" id="nkDay2"></text>
      <text class="dnum" x="60" y="62" text-anchor="middle" dominant-baseline="central" font-size="44"
        transform="rotate(-5 60 60)" fill="var(--k)" id="nkDay"></text>
      <path class="pen p2" d="M60 13.5 C80 12.2 105.4 28.6 106.2 57.4 C107 85 85.6 106.4 59.4 106.8 C32.6 107.2 13.2 86.4 13.8 58.2 C14.4 31 34.6 13.2 60 13.5"/>
      <path class="pen p1" d="M60 13.5 C80 12.2 105.4 28.6 106.2 57.4 C107 85 85.6 106.4 59.4 106.8 C32.6 107.2 13.2 86.4 13.8 58.2 C14.4 31 34.6 13.2 60 13.5 C67.5 13.6 74.2 16.4 79.4 21.2"/>
      <path class="pen p3" d="M73.6 16.4 C82.4 19.8 89.6 25.6 94.6 33.2"/>
    </svg>
  </div>
  <div class="words"><div class="brand" id="nkBrand"></div><div class="tag" id="nkTag"></div></div>
</div>
<script>
(function(){
  var el = document.getElementById('nook-splash');
  if (!el) return;
  var d = new Date();
  var mo = (d.getMonth()+1) + '月', day = String(d.getDate());
  document.getElementById('nkMo').textContent = mo;
  document.getElementById('nkDay').textContent = day;
  document.getElementById('nkDay2').textContent = day;
  function chars(id, text, base, step){
    var box = document.getElementById(id), html = '', i;
    for (i = 0; i < text.length; i++){
      html += '<span style="animation:nkChar .34s cubic-bezier(.3,0,.25,1) ' + (base + i*step).toFixed(2) + 's both">' + text[i] + '</span>';
    }
    box.innerHTML = html;
  }
  chars('nkBrand','Nook',1.46,0.064);
  chars('nkTag','专属你的小角落',1.66,0.046);
  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  var cold = !nav || nav.type === 'navigate' || nav.type === 'reload';
  var off = document.documentElement.dataset.plMotion === 'none';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!cold || off || reduce){ el.parentNode.removeChild(el); return; }
  function ready(){ return !!document.querySelector('#app .view, #app > section'); }
  var t = 0, gone = false;
  function bye(){ if (gone) return; gone = true; el.parentNode.removeChild(el); }
  el.addEventListener('click', bye);
  setTimeout(function(){ el.style.pointerEvents = 'none'; }, 2600);
  (function wait(){
    t += 200;
    if (t === 2600) el.classList.add('is-out');      /* 背景先透明 -> 主界面露出来 */
    if (t >= 3800 && ready()) return bye();
    if (t >= 6500) return bye();
    setTimeout(wait, 200);
  })();
})();
</script>'''

h = rd("index.html")
i = h.find('<style id="nook-splash-css">')
assert i >= 0, "找不到旧的开屏块"
k = h.find("chars('nkTag'", i)
assert k > i, "找不到开屏脚本"
j = h.find('</script>', k)
assert j > k, "找不到开屏脚本结尾"
j += len('</script>')
h = h[:i] + BLOCK + h[j:]
wr("index.html", h)
print("② 开屏已升级：波纹 %d 处 / 暖光 %d 处 / 压印 %d 处 / 主题变量 %d 处" % (
    h.count('class="burst'), h.count('class="glow"'), h.count('fill-opacity=".62"'), h.count('--k:')))

# ── 版本 → 1.1.60 (161) ────────────────────────────────────────────
wr("package.json", re.sub(r'("version"\s*:\s*")[^"]+(")', r'\g<1>1.1.60\g<2>', rd("package.json"), count=1))
a = rd("app-updater.js")
a = re.sub(r"APP_VERSION_NAME = '[^']+'", "APP_VERSION_NAME = '1.1.60'", a, 1)
a = re.sub(r"APP_VERSION_CODE = \d+", "APP_VERSION_CODE = 161", a, 1)
wr("app-updater.js", a)
g = rd("android/app/build.gradle")
g = re.sub(r"versionCode \d+", "versionCode 161", g, 1)
g = re.sub(r'versionName "[^"]+"', 'versionName "1.1.60"', g, 1)
wr("android/app/build.gradle", g)
wr("index.html", re.sub(r"\?v=\d+\.\d+\.\d+", "?v=1.1.60", rd("index.html")))
n = rd("release-notes.js")
if "161: {" not in n:
    add = ("\r\n  161: {\r\n    name: '1.1.60', date: '2026-10-17', time: '01:35:00',\r\n"
           "    title: '桌面名字修好了；开场也补齐了（和预览一致）',\r\n"
           "    summary: '上一版桌面上还是旧名字（改漏了启动界面的那一条）；开场也少了波纹、暖光和数字的压印。这一版都补齐了。',\r\n"
           "    bullets: [\r\n"
           "      '桌面图标下面的名字，这次真的会变成 Nook（上次改漏了一条）',\r\n"
           "      '开场补齐：按下时三圈波纹荡开 + 一团暖光炸开',\r\n"
           "      '圈里的日期有了压印和倾斜（像刻在纸上）',\r\n"
           "      '清简主题下开场是墨蓝+靛青（不再是朱砂红）',\r\n"
           "      '两行字会盖在主界面上多停一会儿再退（不是一起消失）'\r\n    ],\r\n    screenshots: []\r\n  }\r\n};")
    wr("release-notes.js", n.rstrip()[:-2].rstrip() + "," + add)
print("版本 → 1.1.60 (161)")
