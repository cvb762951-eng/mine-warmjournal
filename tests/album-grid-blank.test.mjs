import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stylesCss = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const snippetsSrc = readFileSync(new URL('../views/snippets.js', import.meta.url), 'utf8');

test('styles.css contains .snippet-album-grid-cell > .photo-blur-frame.snippet-album-grid-frame with required declarations', () => {
  const selector = '.snippet-album-grid-cell > .photo-blur-frame.snippet-album-grid-frame';
  assert.ok(stylesCss.includes(selector), `styles.css should contain selector ${selector}`);

  const ruleMatch = stylesCss.match(/\.snippet-album-grid-cell > \.photo-blur-frame\.snippet-album-grid-frame\s*\{([^}]*)\}/);
  assert.ok(ruleMatch, 'rule should exist with body');
  const body = ruleMatch[1];

  assert.ok(body.includes('display:block!important'), 'body should contain display:block!important');
  assert.ok(body.includes('position:absolute!important'), 'body should contain position:absolute!important');
  assert.ok(body.includes('inset:0!important'), 'body should contain inset:0!important');
  assert.ok(body.includes('height:100%!important'), 'body should contain height:100%!important');
});

test('views/snippets.js snippetGridMediaHtml wraps photos in photo-blur-frame is-edge snippet-album-grid-frame and calls snippetPhotoImage', () => {
  const fnMatch = snippetsSrc.match(/function snippetGridMediaHtml\([\s\S]*?\n\}/);
  assert.ok(fnMatch, 'snippetGridMediaHtml function should exist');
  const fnBody = fnMatch[0];

  assert.match(fnBody, /photo-blur-frame is-edge snippet-album-grid-frame/);
  assert.match(fnBody, /snippetPhotoImage\(/);
});
