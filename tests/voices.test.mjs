import assert from 'node:assert/strict';
import {
  mandarinVoiceScore, normalizeLang, pickMandarinVoice,
  sortedMandarinVoices, voiceId,
} from '../extension/lib/voices.js';

assert.equal(normalizeLang('zh_CN'), 'zh-cn');

const voices = [
  { voiceName: 'English', lang: 'en-US' },
  { voiceName: 'Compact Mandarin', lang: 'zh-CN' },
  { voiceName: 'Tingting Enhanced', lang: 'zh-CN' },
  { voiceName: 'Meijia', lang: 'zh-TW' },
];

assert.equal(sortedMandarinVoices(voices)[0].voiceName, 'Tingting Enhanced');
assert.equal(pickMandarinVoice(voices).voiceName, 'Tingting Enhanced');
assert.equal(pickMandarinVoice(voices, voiceId(voices[2])).voiceName, 'Tingting Enhanced');
assert.equal(pickMandarinVoice(voices, voiceId(voices[3])).voiceName, 'Meijia');
assert.equal(mandarinVoiceScore(voices[0]), -1);
assert.ok(mandarinVoiceScore(voices[2]) > mandarinVoiceScore(voices[1]));

console.log('OK — 7 voice tests passed');
