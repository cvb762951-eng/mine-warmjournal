# -*- coding: utf-8 -*-
"""收尾：focus.js 去重复插入；把「专注能挂习惯」那条测试反过来（守切割）"""
import io, os, re

CLONE = "C:/Users/cvb/Documents/ChatGPT/.mine-gh-publish"
rd = lambda p: io.open(os.path.join(CLONE, p), encoding="utf-8", newline="").read()
wr = lambda p, s: io.open(os.path.join(CLONE, p), "w", encoding="utf-8", newline="").write(s)

# ① focus.js：把重复的「注释 + return」压成一份
p = "views/focus.js"
s = rd(p)
pat = re.compile(r"(      // 2026-10-17 切割：专注不再挂到任何习惯上。\n      return '';\n)(      // 2026-10-17 切割：专注不再挂到任何习惯上。\n      return '';\n)+")
before = len(re.findall(r"2026-10-17 切割：专注不再挂到任何习惯上", s))
s = pat.sub(r"\1", s)
after = len(re.findall(r"2026-10-17 切割：专注不再挂到任何习惯上", s))
wr(p, s)
print("focus.js 注释重复：%d → %d" % (before, after))

# ② 测试：把断言改成「已切割」（谁再加回来就红）
p = "tests/ledger-taste-bridge.test.mjs"
s = rd(p)
old = """test('focus settings expose a way to pick the linked habit', () => {
  assert.match(focusSource, /id="timer-settings-form"/, '计时设置应含联动选择器');
  assert.match(focusSource, /name="focusLinkedHabit"/, '应有习惯选择字段');
  assert.match(focusSource, /focusLinkedHabitId = linkable ? linkedId : ''/, '保存时应校验候选合法性');
});"""
new = """test('habits are decoupled from focus (no linked-habit picker)', () => {
  // 2026-10-17 用户要求：习惯与专注彻底切割。
  // 这条测试守住「反向」：以后谁再把联动加回来，它会立刻变红。
  assert.match(focusSource, /id="timer-settings-form"/, '计时设置表单应保留');
  assert.doesNotMatch(focusSource, /name="focusLinkedHabit"/, '不应再有习惯选择字段');
  assert.doesNotMatch(focusSource, /focusLinkedHabitId = linkable/, '保存时不应再校验联动');
  assert.match(focusSource, /切割：专注不再挂到任何习惯上/, '应保留切割注释与空占位');
});"""
if old in s:
    wr(p, s.replace(old, new, 1))
    print("测试已反转：不再要求联动，改为守切割")
else:
    print("!! 测试原文没匹配上")
