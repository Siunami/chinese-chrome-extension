// Encode mono Float32 samples as a 16-bit PCM WAV (the format Azure Speech and
// most STT services accept directly). Pure; unit-tested against the RIFF header.

// Linear resample to a lower rate. The mic runs at 44.1/48 kHz; speech services
// want 16 kHz mono, which is also smaller to upload. Returns a Float32Array.
export function resample(samples, srIn, srOut) {
  if (srOut >= srIn) return samples;
  const ratio = srIn / srOut;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    out[i] = j + 1 < samples.length ? samples[j] * (1 - frac) + samples[j + 1] * frac : samples[j];
  }
  return out;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

// `samples`: Float32Array in [-1, 1]. Returns an ArrayBuffer of a complete WAV.
export function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const byteRate = sampleRate * blockAlign;
  const dataBytes = n * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
