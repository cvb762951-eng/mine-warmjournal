# -*- coding: utf-8 -*-
"""修两处被测试挡下的地方：图标底色回 #F2E8D8（原生启动要求）+ 名字测试同步改成 Nook"""
import io, os, re, subprocess, glob

CLONE = "C:/Users/cvb/Documents/ChatGPT/.mine-gh-publish"
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
INK, POP, BGRES = "#1C1A17", "#C0442C", "#F2E8D8"     # 底色必须是 #F2E8D8（测试 303）
BG1, BG2 = "#F7F1E6", "#EFE5D5"                        # 图内纸面（和 #F2E8D8 同族，边缘看不出差）

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
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">'
            '<defs><linearGradient id="g%s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/>'
            '<stop offset="1" stop-color="%s"/></linearGradient></defs>'
            '<rect width="108" height="108" fill="url(#g%s)"/>'
            '<g opacity=".14" transform="translate(1.7 2.5)">%s</g>'
            '<g opacity=".72" transform="translate(-0.9 -0.9)">%s</g>'
            '<g opacity=".16" transform="translate(0.9 1.0)">%s</g>%s</svg>') % (
        uid, BG1, BG2, uid, st(INK, INK), st("#FFFFFF", "#FFFFFF"), st(INK, INK), st(INK, POP))

def render(svg, w, h, out, round_mask=False):
    tmp = os.path.join(CLONE, "_ic.html")
    css = "html,body{margin:0;padding:0;width:%dpx;height:%dpx;overflow:hidden}" % (w, h)
    if round_mask: css += "body{border-radius:50%;overflow:hidden}"
    io.open(tmp, "w", encoding="utf-8").write('<!doctype html><meta charset="utf-8"><style>%s</style>%s' % (css, svg))
    subprocess.run([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1", "--window-size=%d,%d" % (w, h),
                    "--virtual-time-budget=1500", "--screenshot=" + out,
                    "file:///" + tmp.replace("\\", "/")], capture_output=True)

res = os.path.join(CLONE, "android/app/src/main/res")
for d, k in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
    folder = os.path.join(res, "mipmap-" + d); os.makedirs(folder, exist_ok=True)
    render(mark_svg("f" + d), int(108 * k), int(108 * k), os.path.join(folder, "ic_launcher_foreground.png"))
    render(mark_svg("l" + d), int(48 * k), int(48 * k), os.path.join(folder, "ic_launcher.png"))
    render(mark_svg("r" + d), int(48 * k), int(48 * k), os.path.join(folder, "ic_launcher_round.png"), True)
for size in (192, 512):
    render(mark_svg("p%d" % size), size, size, os.path.join(CLONE, "assets", "icon-%d.png" % size))
print("图标已按 #F2E8D8 同族底色重出（5 档 × 3 + PWA）")

# 底色资源写回 #F2E8D8
for cf in glob.glob(os.path.join(res, "values*", "*.xml")):
    x = io.open(cf, encoding="utf-8", newline="").read()
    if "ic_launcher_background" in x:
        x2 = re.sub(r'(<color name="ic_launcher_background">)[^<]*(</color>)', r'\g<1>%s\g<2>' % BGRES, x, count=1)
        if x2 != x:
            io.open(cf, "w", encoding="utf-8", newline="").write(x2)
            print("底色 →", BGRES, os.path.basename(cf))

# 名字测试同步成 Nook（appId 不动）
t = os.path.join(CLONE, "tests/launch-animation.test.mjs")
s = io.open(t, encoding="utf-8", newline="").read()
s = s.replace('<title>暖色生活志</title>', '<title>Nook</title>')
s = s.replace('<string name="app_name">暖色生活志</string>', '<string name="app_name">Nook</string>')
s = s.replace("appName, '暖色生活志'", "appName, 'Nook'")
io.open(t, "w", encoding="utf-8", newline="").write(s)
print("名字测试已同步：" , "Nook" in s, "| appId 未动：", "com.mine.warmjournal" in s)
