# -*- coding: utf-8 -*-
"""收尾：按行去重 focus.js 的重复注释；把测试 328 换成守切割"""
import io, os

CLONE = "C:/Users/cvb/Documents/ChatGPT/.mine-gh-publish"
rd = lambda p: io.open(os.path.join(CLONE, p), encoding="utf-8", newline="").read()
wr = lambda p, s: io.open(os.path.join(CLONE, p), "w", encoding="utf-8", newline="").write(s)

# ① focus.js：连续重复行去重（只针对切割注释那一行，连带的 return 保留一份）
p = "views/focus.js"
lines = rd(p).split("\n")
out, seen = [], False
for ln in lines:
    if "2026-10-17 切割：专注不再挂到任何习惯上" in ln:
        if seen:
            continue
        seen = True
    out.append(ln)
# 去掉因删注释而重复出现的紧邻 return ''; （注释与 return 成对出现两次时）
res = []
i = 0
while i < len(out):
    ln = out[i]
    if ln.strip() == "return '';" and res and res[-1].strip() == "return '';":
        i += 1
        continue
    res.append(ln)
    i += 1
wr(p, "\n".join(res))
print("focus.js 注释数：", "\n".join(res).count("2026-10-17 切割：专注不再挂到任何习惯上"))

# ② 测试：按行找 test(...) 块并整块替换
p = "tests/ledger-taste-bridge.test.mjs"
lines = rd(p).split("\n")
start = next((i for i, ln in enumerate(lines) if "focus settings expose a way to pick the linked habit" in ln), -1)
if start < 0:
    print("!! 找不到那条测试")
else:
    end = next(i for i in range(start + 1, len(lines)) if lines[i].strip() == "});")
    new = [
        "test('habits are decoupled from focus (no linked-habit picker)', () => {",
        "  // 2026-10-17 用户要求：习惯与专注彻底切割。这条测试守「反向」—— 谁把联动加回来就红。",
        "  assert.match(focusSource, /id=\"timer-settings-form\"/, '计时设置表单应保留');",
        "  assert.doesNotMatch(focusSource, /name=\"focusLinkedHabit\"/, '不应再有习惯选择字段');",
        "  assert.doesNotMatch(focusSource, /focusLinkedHabitId = linkable/, '保存时不应再校验联动');",
        "  assert.match(focusSource, /切割：专注不再挂到任何习惯上/, '应保留切割注释与空占位');",
        "});",
    ]
    lines[start:end + 1] = new
    wr(p, "\n".join(lines))
    print("测试 328 已翻转为守切割")
