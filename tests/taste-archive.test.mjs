import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makeDefaultState, makeTasteEntry, migrateState, SCHEMA_VERSION, tastePlaceGroups } from '../model.js';
import { rebuildActivityLog } from '../activity-log.js';

const view = await readFile(new URL('../views/taste.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const storage = await readFile(new URL('../storage.js', import.meta.url), 'utf8');
const mediaStore = await readFile(new URL('../media-store.js', import.meta.url), 'utf8');
const mine = await readFile(new URL('../views/mine.js', import.meta.url), 'utf8');
const calendar = await readFile(new URL('../views/calendar.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('taste records normalize local data and old states migrate with an empty archive', () => {
  const entry = makeTasteEntry({ type:'snack', name:' 黑松露薯片 ', brand:'示例品牌', rating:9, verdict:'favorite', price:'12.345', flavorTags:['酥脆','咸香','酥脆'], photos:['data:image/jpeg;base64,AAAA','https://example.com/no.jpg'], notes:'会回购' });
  assert.equal(entry.name, '黑松露薯片');
  assert.equal(entry.rating, 5);
  assert.equal(entry.price, 12.35);
  assert.deepEqual(entry.flavorTags, ['酥脆','咸香']);
  assert.equal(entry.photos.length, 1);
  const migrated = migrateState({});
  assert.equal(migrated.meta.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.tasteEntries, []);
});

test('store groups are generated from food-first entries without duplicating records', () => {
  const entries = [
    makeTasteEntry({ id:'a', name:'牛肉面', placeName:'某某面馆', rating:5, verdict:'favorite', updatedAt:30 }),
    makeTasteEntry({ id:'b', name:'锅贴', placeName:'某某面馆', rating:3, verdict:'okay', updatedAt:20 }),
    makeTasteEntry({ id:'c', type:'place', name:'咖啡小店', rating:4, verdict:'again', updatedAt:10 })
  ];
  const groups = tastePlaceGroups(entries);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, '某某面馆');
  assert.equal(groups[0].entries.length, 2);
  assert.equal(groups[0].averageRating, 4);
  assert.equal(groups[0].favorites, 1);
});

test('taste records enter Calendar activity and open the original archive item', () => {
  const state = makeDefaultState();
  state.tasteEntries.push(makeTasteEntry({ id:'taste-1', name:'草莓蛋糕', placeName:'街角甜品店', date:'2026-09-19', verdict:'again', createdAt:new Date('2026-09-19T15:00:00').getTime() }));
  const event = rebuildActivityLog(state).find(item => item.kind === 'taste');
  assert.equal(event.title, '草莓蛋糕');
  assert.match(event.summary, /还会再吃.*街角甜品店/);
  assert.match(calendar, /taste: \{ icon: 'restaurant_menu'/);
  assert.match(calendar, /\['habit', 'photo', 'taste', 'expense'/);
  assert.match(app, /item\.kind === 'taste'[\s\S]*openTasteEntry/);
});

test('taste archive is a secondary Mine destination with complete first-version interactions', () => {
  assert.match(mine, /id="open-taste-archive"/);
  assert.match(mine, /go\('taste'\)/);
  assert.match(view, /味觉档案/);
  assert.match(view, /回购清单/);
  assert.match(view, /避雷清单/);
  assert.match(view, /店铺档案/);
  assert.match(view, /tasteFilter === 'all' && !tasteSearch\.trim\(\)/);
  assert.match(view, /taste-search-form/);
  assert.match(view, /taste-form/);
  assert.match(view, /importPhotoBatch/);
  assert.match(view, /confirmDelete/);
  assert.match(view, /registerHelper\('openTasteEntry'/);
  assert.match(styles, /Taste Archive/);
  assert.match(styles, /\.taste-hero-paper\{[^}]*background-color:#e5dfc9[^}]*color:#244c3d/);
  assert.doesNotMatch(styles, /\.taste-hero-paper\{[^}]*background-color:#244c3d/);
  assert.match(styles, /\.phone-shell:has\(\.taste-view\) \.floating-dock\{display:none\}/);
});

test('taste records participate in section backup and media externalization', () => {
  assert.match(storage, /'tasteEntries'/);
  assert.match(mediaStore, /state\?\.tasteEntries/);
});
