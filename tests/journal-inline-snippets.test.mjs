import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../views/journal.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Journal import action renders an inline picker for snippets and photos', () => {
  assert.match(source, /function journalSnippetPicker\(day\)/);
  assert.match(source, /id="journal-inline-snippet-picker"/);
  assert.match(source, /data-journal-snippet/);
  assert.match(source, /id="journal-inline-snippet-apply"/);
  assert.match(source, /把选中素材加入 \$\{dateLabel\} 日记/);
  assert.match(source, /journal-inline-snippet-close[^>]*aria-label="关闭素材选择"><span class="material-symbols-outlined">close/);
  assert.match(source, /#journal-import-snippets'\)\?\.addEventListener\('click', \(\) => \{ const panel/);
  assert.doesNotMatch(source, /#journal-import-snippets'\)\?\.addEventListener\('click', \(\) => journalForm/);
  assert.match(source, /filter\(entry => entry\?\.date === day\)/);
  assert.match(source, /选择 \$\{dateLabel\} 的素材/);
  assert.match(source, /只有这一天的随手拍和随手记会显示/);
});

test('Inline snippet selection keeps photos and text in the current journal draft', () => {
  assert.match(source, /const textParts = entries\.filter/);
  assert.match(source, /const photos = entries\.filter\(entry => entry\.type === 'photo'/);
  assert.match(source, /state\.journals\[day\] = \{ \.\.\.previous, photos:/);
  assert.match(source, /已加入 \$\{entries\.length\} 条素材/);
  assert.match(styles, /\.journal-inline-snippet-item:has\(input:checked\)/);
  assert.match(styles, /journal-archive-drawer-v1\.png/);
  assert.match(styles, /journal-source-slip-v1\.png/);
  assert.match(styles, /journal-inline-snippet-list\{[^}]*overflow-y:auto/);
  assert.match(styles, /Journal inline source picker lock/);
  assert.match(styles, /\.journal-inline-snippet-picker\{[\s\S]*?position:relative!important/);
  assert.match(styles, /Browser comments final lock/);
  assert.match(styles, /height:clamp\(620px,78dvh,820px\)/);
  assert.match(styles, /\.journal-inline-snippet-list\{[\s\S]*?grid-template-columns:1fr!important/);
  assert.match(styles, /@media\(min-width:720px\)[\s\S]*?grid-template-columns:1fr 1fr!important/);
  assert.match(styles, /phone-shell:has\(#journal-inline-snippet-picker:not\(\[hidden\]\)\) \.floating-dock\{visibility:visible!important/);
  assert.match(styles, /\.journal-inline-snippet-list\{[\s\S]*?scrollbar-width:none/);
  assert.match(styles, /\.journal-inline-snippet-list::-webkit-scrollbar\{display:none/);
  assert.match(styles, /height:clamp\(720px,84dvh,900px\)/);
  assert.match(styles, /background-size:112% 105%!important/);
});

test('Journal reader does not repeat the lead as a fabricated quote', () => {
  assert.match(source, /const quoteHtml = entry\.summary\?\.trim\(\) \?/);
  assert.doesNotMatch(source, /entry\.summary \|\| lead\.slice/);
  assert.match(styles, /journal-reader-paper h1[^\n]*Newsreader','Noto Serif SC'/);
  assert.match(styles, /-webkit-text-size-adjust: 100%/);
});
