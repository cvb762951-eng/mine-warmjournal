import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sampleRate = 44100;
// 每 1.8 秒响一次双音，既会持续提醒，也避免形成刺耳的连续蜂鸣。
const sampleCount = Math.floor(sampleRate * 1.8);
const pcm = new Int16Array(sampleCount);
const tones = [{ frequency: 659.25, start: 0, duration: 0.19 }, { frequency: 783.99, start: 0.21, duration: 0.3 }];
for (let index = 0; index < sampleCount; index += 1) {
  const time = index / sampleRate;
  let sample = 0;
  for (const tone of tones) {
    const localTime = time - tone.start;
    if (localTime < 0 || localTime > tone.duration) continue;
    const envelope = Math.max(0, Math.min(1, localTime / 0.025, (tone.duration - localTime) / 0.08));
    sample += Math.sin(2 * Math.PI * tone.frequency * localTime) * envelope * 0.22;
  }
  pcm[index] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
}
const dataBytes = pcm.byteLength;
const wav = Buffer.alloc(44 + dataBytes);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40);
for (let index = 0; index < pcm.length; index += 1) wav.writeInt16LE(pcm[index], 44 + index * 2);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'android/app/src/main/res/raw/timer_complete.wav');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, wav);
console.log(`Generated ${output} (${wav.length} bytes)`);
