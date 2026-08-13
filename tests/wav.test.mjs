import assert from 'node:assert/strict';
import { encodeWav, resample } from '../extension/lib/wav.js';

const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
const buf = encodeWav(samples, 16000);
const view = new DataView(buf);
const ascii = (o, len) => Array.from({ length: len }, (_, i) => String.fromCharCode(view.getUint8(o + i))).join('');

// Header is a well-formed 16-bit mono PCM WAV at the given rate.
assert.equal(buf.byteLength, 44 + samples.length * 2);
assert.equal(ascii(0, 4), 'RIFF');
assert.equal(ascii(8, 4), 'WAVE');
assert.equal(ascii(12, 4), 'fmt ');
assert.equal(view.getUint16(20, true), 1, 'PCM');
assert.equal(view.getUint16(22, true), 1, 'mono');
assert.equal(view.getUint32(24, true), 16000, 'sample rate');
assert.equal(view.getUint32(28, true), 32000, 'byte rate = rate * 2');
assert.equal(view.getUint16(34, true), 16, 'bits per sample');
assert.equal(ascii(36, 4), 'data');
assert.equal(view.getUint32(40, true), samples.length * 2);

// Full-scale samples clamp to the 16-bit range without overflow.
assert.equal(view.getInt16(44 + 6, true), 0x7fff, '+1.0 → max');
assert.equal(view.getInt16(44 + 8, true), -0x8000, '-1.0 → min');

// Resample 48k -> 16k roughly thirds the length; a no-op when target >= input.
{
  const src = new Float32Array(4800); // 0.1s @ 48k
  const down = resample(src, 48000, 16000);
  assert.ok(Math.abs(down.length - 1600) <= 1, `expected ~1600, got ${down.length}`);
  assert.equal(resample(src, 16000, 16000), src, 'no downsample when equal');
  // A linear ramp stays monotonic after resampling (interpolation preserves order).
  const ramp = Float32Array.from({ length: 3000 }, (_, i) => i / 3000);
  const r = resample(ramp, 48000, 16000);
  assert.ok(r[0] < r[r.length - 1] && r[10] < r[500]);
}

console.log('OK — wav encoder tests passed');
