# -*- coding: utf-8 -*-
"""修图标渲染：让 SVG 铺满画布（原来写死 108px，导致只占左上角）+ 重出全部图标 + 升到 1.1.59"""
import io, os, re, subprocess, glob

CLONE = "C:/Users/cvb/Documents/ChatGPT/.mine-gh-publish"
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
INK, POP, BGRES = "#1C1A17", "#C0442C", "#F2E8D8"
BG1, BG2 = "#F7F1E6", "#EFE5D5"

def brush(pts, widths):
    L, R = [], []
    for i, p in enumerate(pts):
        pv = pts[max(0, i - 1)]; nx = pts[min(len(pts) - 1, i + 1)]
        dx, dy = nx[0] - pv[0], nx[1] - pv[1]
        n = (dx * dx + dy * dy) ** 0.5 or 1
        dx, dy = dx / n, dy / n
        vx, vy = -dy, dx; w = widths[i]
        L.append((p[0] + vx * w, p[1] + vy * w)); R.append((p[0] - vx * w, p[1] - vy * w))
    return "M" + " L".join("%.2f %.2f" % q for q in L) + " L" + " L".join("%.2f %.2f" % q for q in reversed(R)) + " Z"

BAR_L = brush([[38.5, 33], [37.6, 45], [37.2, 58], [37.6, 70], [38.2, 76]], [3.3, 4.5, 4.7, 4.2, 3.1])
BAR_R = brush([[73.5, 75.5], [73.9, 63], [74.2, 50], [74.6, 38], [74.2, 32]], [3.0, 4.3, 4.6, 4.3, 3.4])
SWASH = brush([[38.6, 32], [48, 42], [58, 52.5], [68, 63], [76.5, 72], [85, 72.5], [92, 68.5]],
              [4.7, 4.9, 5.0, 4.8, 4.2, 2.5, 0.5])

def mark_svg(uid):
    st = lambda a, b: ('<g transform="rotate(-3 54 54)"><path d="%s" fill="%s"/><path d="%s" fill="%s"/>'
                       '<path d="%s" fill="%s"/></g>') % (BAR_L, a, BAR_R, a, SWASH, b)
    # 🔴 宽高写成 100%%，让它铺满画布（配合 viewBox 缩放）—— 上一版写死 108 是 bug
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="100%%" height="100%%" viewBox="0 0 108 108" '
            'preserveAspectRatio="xMidYMid slice">'
            '<defs><linearGradient id="g%s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/>'
            '<stop offset="1" stop-color="%s"/></linearGradient></defs>'
            '<rect width="108" height="108" fill="url(#g%s)"/>'
            '<g opacity=".14" transform="translate(1.7 2.5)">%s</g>'
            '<g opacity=".72" transform="translate(-0.9 -0.9)">%s</g>'
            '<g opacity=".16" transform="translate(0.9 1.0)">%s</g>%s</svg>') % (
        uid, BG1, BG2, uid, st(INK, INK), st("#FFFFFF", "#FFFFFF"), st(INK, INK), st(INK, POP))

def render(svg, w, h, out, round_mask=False):
    tmp = os.path.join(CLONE, "_ic.html")
    css = ("html,body{margin:0;padding:0;width:100%%;height:100%%;overflow:hidden}"
           "svg{display:block;width:%dpx;height:%dpx}" % (w, h))
    if round_mask: css += "body{border-radius:50%;overflow:hidden}"
    io.open(tmp, "w", encoding="utf-8").write(
        '<!doctype html><meta charset="utf-8"><style>%s</style>%s' % (css, svg))
    subprocess.run([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1", "--window-size=%d,%d" % (w, h),
                    "--virtual-time-budget=2000", "--screenshot=" + out,
                    "file:///" + tmp.replace("\\", "/")], capture_output=True)

res = os.path.join(CLONE, "android/app/src/main/res")
for d, k in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
    folder = os.path.join(res, "mipmap-" + d); os.makedirs(folder, exist_ok=True)
    render(mark_svg("f" + d), int(108 * k), int(108 * k), os.path.join(folder, "ic_launcher_foreground.png"))
    render(mark_svg("l" + d), int(48 * k), int(48 * k), os.path.join(folder, "ic_launcher.png"))
    render(mark_svg("r" + d), int(48 * k), int(48 * k), os.path.join(folder, "ic_launcher_round.png"), True)
for size in (192, 512):
    render(mark_svg("p%d" % size), size, size, os.path.join(CLONE, "assets", "icon-%d.png" % size))
print("图标已重出（SVG 铺满画布）")

# 升到 1.1.59 (160)
rd = lambda p: io.open(os.path.join(CLONE, p), encoding="utf-8", newline="").read()
wr = lambda p, s: io.open(os.path.join(CLONE, p), "w", encoding="utf-8", newline="").write(s)
wr("package.json", re.sub(r'("version"\s*:\s*")[^"]+(")', r'\g<1>1.1.59\g<2>', rd("package.json"), count=1))
a = rd("app-updater.js")
a = re.sub(r"APP_VERSION_NAME = '[^']+'", "APP_VERSION_NAME = '1.1.59'", a, 1)
a = re.sub(r"APP_VERSION_CODE = \d+", "APP_VERSION_CODE = 160", a, 1)
wr("app-updater.js", a)
g = rd("android/app/build.gradle")
g = re.sub(r"versionCode \d+", "versionCode 160", g, 1)
g = re.sub(r'versionName "[^"]+"', 'versionName "1.1.59"', g, 1)
wr("android/app/build.gradle", g)
wr("index.html", re.sub(r"\?v=\d+\.\d+\.\d+", "?v=1.1.59", rd("index.html")))
n = rd("release-notes.js")
if "160: {" not in n:
    add = ("\r\n  160: {\r\n    name: '1.1.59', date: '2026-10-17', time: '01:20:00',\r\n"
           "    title: '修好桌面图标（1.1.58 的图标没显示出来）',\r\n"
           "    summary: '上一版的图标在桌面上是一块发白的小方块 —— 出图时那枚 N 只画进了左上角。这一版重新出图，图标正常了。',\r\n"
           "    bullets: [\r\n      '修好桌面图标：上一版只有左上角一小块，现在整枚都在',\r\n"
           "      '名字、图标、开场动画都还是你要的 Nook 那一套'\r\n    ],\r\n    screenshots: []\r\n  }\r\n};")
    wr("release-notes.js", n.rstrip()[:-2].rstrip() + "," + add)
print("版本 → 1.1.59 (160)")
