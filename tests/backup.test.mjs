import assert from 'node:assert/strict';
import { decryptBackupEnvelope, encryptBackupEnvelope } from '../backup.js';

const journalPhoto = 'data:image/jpeg;base64,am91cm5hbC1waG90bw==';
const originalPayload = {
  format: 'mine-backup',
  data: {
    habits: [{ id: 'habit-1', name: '阅读' }],
    todos: [{ id: 'todo-1', date: '2026-08-14', title: '明天的待办', completed: false, createdAt: 123, updatedAt: 123 }],
    sessions: [],
    snippets: [{ id: 'snippet-1', type: 'text', date: '2026-08-13', text: '备份里的随手记', photo: '', createdAt: 123, updatedAt: 123 }],
    journals: {
      '2026-08-13': { content: '带照片的日记', mood: 'calm', weather: 'cloudy', photos: [journalPhoto], updatedAt: 123 }
    },
    media: [{ id: 'movie-1', title: '测试电影', poster: 'data:image/jpeg;base64,dGVzdA==' }]
  }
};
const original = JSON.stringify(originalPayload);

const encrypted = await encryptBackupEnvelope(original, '离线备份密码1234');
assert.equal(encrypted.format, 'mine-encrypted-backup');
assert.equal(encrypted.version, 1);
assert.notEqual(encrypted.ciphertext, original);
const decrypted = await decryptBackupEnvelope(encrypted, '离线备份密码1234');
assert.equal(decrypted, original);
assert.deepEqual(JSON.parse(decrypted), originalPayload);
assert.equal(JSON.parse(decrypted).data.journals['2026-08-13'].photos[0], journalPhoto);
assert.equal(JSON.parse(decrypted).data.snippets[0].text, '备份里的随手记');
assert.equal(JSON.parse(decrypted).data.todos[0].title, '明天的待办');

await assert.rejects(
  () => decryptBackupEnvelope(encrypted, '错误的密码1234'),
  { message: '备份密码错误，或文件已经损坏' }
);

console.log('Encrypted backup round-trip and wrong-password checks passed.');
