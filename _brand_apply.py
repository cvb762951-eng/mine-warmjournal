# -*- coding: utf-8 -*-
"""Nook 品牌落地：改名 + 换图标 + 开屏动画（一次做完）
运行： python _brand_apply.py
"""
import io, json, os, re, subprocess, glob

CLONE = "C:/Users/cvb/Documents/ChatGPT/.mine-gh-publish"
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
NAME = "Nook"
INK, POP, BG1, BG2 = "#1C1A17", "#C0442C", "#FAF7F0", "#F1EBDE"     # 墨 + 朱砂 + 纸

def rd(p):
    return io.open(os.path.join(CLONE, p), encoding="utf-8", newline="").read()

def wr(p, s):
    io.open(os.path.join(CLONE, p), "w", encoding="utf-8", newline="").write(s)

log = []

# ── ① 改名 ───────────────────────────────────────────────────────────
c = rd("capacitor.config.json")
if '"appName": "暖色生活志"' in c:
    wr("capacitor.config.json", c.replace('"appName": "暖色生活志"', '"appName": "%s"' % NAME, 1))
    log.append("capacitor.config.json → appName")

sp = "android/app/src/main/res/values/strings.xml"
if os.path.exists(os.path.join(CLONE, sp)):
    x = rd(sp)
    x2 = re.sub(r'(<string name="app_name">)[^<]*(</string>)', r'\g<1>%s\g<2>' % NAME, x)
    if x2 != x:
        wr(sp, x2)
        log.append("strings.xml → app_name")

h = rd("index.html")
h2 = re.sub(r"<title>[^<]*</title>", "<title>%s</title>" % NAME, h, count=1)
if h2 != h:
    wr("index.html", h2)
    log.append("index.html → title")

for mf in ("android/app/src/main/assets/public/manifest.json", "assets/manifest.json", "manifest.json"):
    if os.path.exists(os.path.join(CLONE, mf)):
        try:
            d = json.loads(rd(mf))
            d["name"] = NAME; d["short_name"] = NAME
            wr(mf, json.dumps(d, ensure_ascii=False, indent=2) + "\n")
            log.append(mf + " → name/short_name")
        except Exception as e:
            log.append(mf + " 解析失败:" + str(e))

# ── ② 图标：生成 SVG → 按尺寸出 PNG ─────────────────────────────────
def brush(pts, widths):
    L, R = [], []
    for i, p in enumerate(pts):
        pv = pts[max(0, i - 1)]; nx = pts[min(len(pts) - 1, i + 1)]
        dx, dy = nx[0] - pv[0], nx[1] - pv[1]
        n = (dx * dx + dy * dy) ** 0.5 or 1
        dx, dy = dx / n, dy / n
        vx, vy = -dy, dx
        w = widths[i]
        L.append((p[0] + vx * w, p[1] + vy * w))
        R.append((p[0] - vx * w, p[1] - vy * w))
    d = "M" + " L".join("%.2f %.2f" % q for q in L) + " L" + " L".join("%.2f %.2f" % q for q in reversed(R)) + " Z"
    return d

BAR_L = brush([[38.5, 33], [37.6, 45], [37.2, 58], [37.6, 70], [38.2, 76]], [3.3, 4.5, 4.7, 4.2, 3.1])
BAR_R = brush([[73.5, 75.5], [73.9, 63], [74.2, 50], [74.6, 38], [74.2, 32]], [3.0, 4.3, 4.6, 4.3, 3.4])
SWASH = brush([[38.6, 32], [48, 42], [58, 52.5], [68, 63], [76.5, 72], [85, 72.5], [92, 68.5]],
              [4.7, 4.9, 5.0, 4.8, 4.2, 2.5, 0.5])

def mark_svg(uid):
    strokes = lambda a, b: ('<g transform="rotate(-3 54 54)"><path d="%s" fill="%s"/><path d="%s" fill="%s"/>'
                            '<path d="%s" fill="%s"/></g>') % (BAR_L, a, BAR_R, a, SWASH, b)
    return """<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">
<defs><linearGradient id="g%s" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient></defs>
<rect width="108" height="108" fill="url(#g%s)"/>
<g opacity=".14" transform="translate(1.7 2.5)">%s</g>
<g opacity=".72" transform="translate(-0.9 -0.9)">%s</g>
<g opacity=".16" transform="translate(0.9 1.0)">%s</g>
%s</svg>""" % (uid, BG1, BG2, uid, strokes(INK, INK), strokes("#FFFFFF", "#FFFFFF"),
               strokes(INK, INK), strokes(INK, POP))

def render(svg, w, h, out, round_mask=False):
    """用无头 Chrome 把 SVG 渲染成精确 W×H 的 PNG"""
    tmp = os.path.join(CLONE, "_ic.html")
    css = "html,body{margin:0;padding:0;width:%dpx;height:%dpx;overflow:hidden}" % (w, h)
    if round_mask:
        css += "body{border-radius:50%%;overflow:hidden}" % ()
    io.open(tmp, "w", encoding="utf-8").write(
        '<!doctype html><meta charset="utf-8"><style>%s</style>%s' % (css, svg))
    subprocess.run([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1", "--window-size=%d,%d" % (w, h),
                    "--virtual-time-budget=1500", "--screenshot=" + out,
                    "file:///" + tmp.replace("\\", "/")], capture_output=True)
    os.path.exists(out) or log.append("!! 出图失败 " + out)

DENSITY = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
res = os.path.join(CLONE, "android/app/src/main/res")
for d, k in DENSITY.items():
    d = d.replace(".", "")
    folder = os.path.join(res, "mipmap-" + d)
    os.makedirs(folder, exist_ok=True)
    render(mark_svg("f" + d), int(108 * k), int(108 * k), os.path.join(folder, "ic_launcher_foreground.png"))
    render(mark_svg("l" + d), int(48 * k), int(48 * k), os.path.join(folder, "ic_launcher.png"))
    render(mark_svg("r" + d), int(48 * k), int(48 * k), os.path.join(folder, "ic_launcher_round.png"), round_mask=True)
log.append("图标已出：5 档 × 3 个 + PWA")

# PWA 图标
for size in (192, 512):
    tgt = os.path.join(CLONE, "assets", "icon-%d.png" % size)
    os.makedirs(os.path.dirname(tgt), exist_ok=True)
    render(mark_svg("p%d" % size), size, size, tgt)
    tgt2 = os.path.join(CLONE, "www", "icon-%d.png" % size)
    if os.path.isdir(os.path.dirname(tgt2)):
        render(mark_svg("q%d" % size), size, size, tgt2)

# 背景色 = 纸色
for cf in glob.glob(os.path.join(res, "values*", "*.xml")):
    x = io.open(cf, encoding="utf-8", newline="").read()
    if "ic_launcher_background" in x:
        x2 = re.sub(r'(<color name="ic_launcher_background">)[^<]*(</color>)', r'\g<1>%s\g<2>' % BG1, x)
        if x2 != x:
            io.open(cf, "w", encoding="utf-8", newline="").write(x2)
            log.append("背景色 → " + BG1 + " (" + os.path.basename(cf) + ")")

# ── ③ 开屏动画（插进 index.html，自包含）────────────────────────────
h = rd("index.html")
if "nook-splash" not in h:
    splash = """
<style id="nook-splash-css">
#nook-splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;
  justify-content:center;background:#F7F3EA;font-family:'LXGW WenKai Screen R','Noto Serif SC',serif}
html[data-theme="plain"] #nook-splash{background:#EEF3FA}
#nook-splash .mo{font-size:13.5px;letter-spacing:.34em;text-indent:.34em;color:#5A5044;opacity:0;
  animation:nkMo .62s ease .1s both}
html[data-theme="plain"] #nook-splash .mo{color:#5A6572}
#nook-splash svg{width:184px;height:184px;display:block}
#nook-splash .dnum{font-family:'LXGW WenKai Screen R','Noto Serif SC',serif;
  transform-box:view-box;transform-origin:60px 60px;
  animation:nkNum .62s cubic-bezier(.3,0,.25,1) .2s both, nkCaught .74s cubic-bezier(.3,.9,.3,1) 1.2s both}
#nook-splash .pen{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:2000;stroke-dashoffset:2000}
#nook-splash .p1{stroke:#1C1A17;stroke-width:5.1;animation:nkPen .92s cubic-bezier(.34,.08,.24,1) .36s both}
#nook-splash .p2{stroke:#1C1A17;stroke-width:3.4;animation:nkPen .84s cubic-bezier(.36,.08,.24,1) .44s both}
#nook-splash .p3{stroke:#C0703C;stroke-width:2.4;animation:nkPen .42s cubic-bezier(.4,0,.3,1) 1.06s both}
#nook-splash .brand{font-size:30px;letter-spacing:.26em;text-indent:.26em;color:#2A2620;line-height:1;margin-top:6px}
#nook-splash .tag{font-size:12.5px;letter-spacing:.36em;text-indent:.36em;margin-top:11px;color:#C0442C}
#nook-splash .brand span,#nook-splash .tag span{display:inline-block;opacity:0}
#nook-splash .words{animation:nkWords .62s ease 3.06s both}
@keyframes nkMo{0%{opacity:0;letter-spacing:.6em}100%{opacity:.62;letter-spacing:.34em}}
@keyframes nkNum{0%{opacity:0}100%{opacity:1}}
@keyframes nkCaught{0%{transform:rotate(-5deg) scale(1)}52%{transform:rotate(-1.5deg) scale(1.045,1.035)}
  100%{transform:rotate(-5deg) scale(1)}}
@keyframes nkPen{0%{stroke-dashoffset:2000}100%{stroke-dashoffset:0}}
@keyframes nkChar{0%{opacity:0;transform:translateY(4px)}100%{opacity:1;transform:none}}
@keyframes nkWords{0%{opacity:1}100%{opacity:0;transform:translateY(-7px)}}
@keyframes nkOut{0%{opacity:1}100%{opacity:0}}
#nook-splash.is-out{animation:nkOut .72s ease both;pointer-events:none}
@media (prefers-reduced-motion:reduce){#nook-splash{display:none}}
</style>
<div id="nook-splash" aria-hidden="true">
  <div class="mo" id="nkMo"></div>
  <svg viewBox="0 0 120 120" aria-hidden="true">
    <text class="dnum" x="60" y="62" text-anchor="middle" dominant-baseline="central" font-size="44"
      transform="rotate(-5 60 60)" fill="#1C1A17" id="nkDay"></text>
    <path class="pen p2" d="M60 13.5 C80 12.2 105.4 28.6 106.2 57.4 C107 85 85.6 106.4 59.4 106.8 C32.6 107.2 13.2 86.4 13.8 58.2 C14.4 31 34.6 13.2 60 13.5"/>
    <path class="pen p1" d="M60 13.5 C80 12.2 105.4 28.6 106.2 57.4 C107 85 85.6 106.4 59.4 106.8 C32.6 107.2 13.2 86.4 13.8 58.2 C14.4 31 34.6 13.2 60 13.5 C67.5 13.6 74.2 16.4 79.4 21.2"/>
    <path class="pen p3" d="M73.6 16.4 C82.4 19.8 89.6 25.6 94.6 33.2"/>
  </svg>
  <div class="words"><div class="brand" id="nkBrand"></div><div class="tag" id="nkTag"></div></div>
</div>
<script>
(function(){
  var el = document.getElementById('nook-splash');
  if (!el) return;
  var d = new Date();
  document.getElementById('nkMo').textContent = (d.getMonth()+1) + '月';
  document.getElementById('nkDay').textContent = String(d.getDate());
  function chars(id, text, base, step){
    var box = document.getElementById(id), html = '';
    for (var i = 0; i < text.length; i++){
      html += '<span style="animation:nkChar .34s cubic-bezier(.3,0,.25,1) ' + (base + i*step).toFixed(2) + 's both">' + text[i] + '</span>';
    }
    box.innerHTML = html;
  }
  chars('nkBrand','Nook',1.46,0.064);
  chars('nkTag','专属你的小角落',1.66,0.046);
  /* 冷启动才播；动效关掉或系统减弱动态效果则直接跳过 */
  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  var cold = !nav || nav.type === 'navigate' || nav.type === 'reload';
  var off = document.documentElement.dataset.plMotion === 'none';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!cold || off || reduce){ el.parentNode.removeChild(el); return; }
  /* 3.4s 起把开屏淡出（等 App 已就绪；没就绪就再等，最多到 6s） */
  function ready(){ return !!document.querySelector('#app .view, #app > section'); }
  function go(){ el.classList.add('is-out'); setTimeout(function(){ el.parentNode.removeChild(el); }, 760); }
  var t = 0;
  (function wait(){
    t += 200;
    if (t >= 3400 && ready()) return go();
    if (t >= 6000) return go();
    setTimeout(wait, 200);
  })();
  /* 点一下跳过 */
  el.addEventListener('click', function(){ el.parentNode.removeChild(el); });
})();
</script>
"""
    h = h.replace("<body>", "<body>" + splash, 1) if "<body>" in h else h
    wr("index.html", h)
    log.append("开屏动画已插入 index.html")

# ── ④ 版本号 1.1.58 (159) + 更新说明 ────────────────────────────────
p = rd("package.json"); p2 = re.sub(r'("version"\s*:\s*")[^"]+(")', r'\g<1>1.1.58\g<2>', p, count=1)
if p2 != p: wr("package.json", p2); log.append("package.json → 1.1.58")
a = rd("app-updater.js")
a2 = re.sub(r"APP_VERSION_NAME = '[^']+'", "APP_VERSION_NAME = '1.1.58'", a, 1)
a2 = re.sub(r"APP_VERSION_CODE = \d+", "APP_VERSION_CODE = 159", a2, 1)
if a2 != a: wr("app-updater.js", a2); log.append("app-updater.js → 1.1.58/159")
g = rd("android/app/build.gradle")
g2 = re.sub(r"versionCode \d+", "versionCode 159", g, 1)
g2 = re.sub(r'versionName "[^"]+"', 'versionName "1.1.58"', g2, 1)
if g2 != g: wr("android/app/build.gradle", g2); log.append("build.gradle → 1.1.58/159")
h = rd("index.html"); h2 = re.sub(r"\?v=\d+\.\d+\.\d+", "?v=1.1.58", h)
if h2 != h: wr("index.html", h2); log.append("index.html → ?v=1.1.58")
n = rd("release-notes.js")
if "159: {" not in n:
    bullets = ["改名叫 Nook 了 —— 桌面上的名字、里面的标题都换了",
               "换了一枚新图标：一个 N，中间那一笔是朱砂红（像刚写完、墨还没干）",
               "打开时会有一小段开场：今天的日期写在中间、被手写的一圈圈住，然后 Nook 和「专属你的小角落」浮现出来",
               "开场动画跟着主题走：暖色是墨+朱砂，清简是墨蓝+靛青",
               "不想看就点一下跳过；把动效关掉的人直接进 App"]
    add = ("\r\n  159: {\r\n    name: '1.1.58', date: '2026-10-17', time: '00:30:00',\r\n"
           "    title: '改名叫 Nook，换了新图标，还加了一段开场',\r\n"
           "    summary: '从今天起这个 App 叫 Nook。图标是一个 N（中间那一笔是朱砂红）；打开时有一段很短的仪式：今天的日期被手写的一圈圈住，然后 Nook 浮现。',\r\n"
           "    bullets: [\r\n" + ",\r\n".join("      '%s'" % b for b in bullets) +
           "\r\n    ],\r\n    screenshots: []\r\n  }\r\n};")
    wr("release-notes.js", n.rstrip()[:-2].rstrip() + "," + add)
    log.append("release-notes.js → 159")

# 其他可能残留的旧名字（只报告，不盲改）
left = []
for f in glob.glob(os.path.join(CLONE, "*.js")) + glob.glob(os.path.join(CLONE, "*.json")) + glob.glob(os.path.join(CLONE, "views", "*.js")):
    if os.path.basename(f).startswith("release-notes"): continue
    try:
        if "暖色生活志" in io.open(f, encoding="utf-8").read(): left.append(os.path.basename(f))
    except Exception: pass

print("== 落地完成 ==")
for x in log: print(" ·", x)
print(" · 仍含旧名字（未盲改，仅报告）:", left if left else "无")
