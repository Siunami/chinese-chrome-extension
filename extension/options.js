import { DEFAULT_SERVER_URL, getAiKey, getSyncMeta, newToken, pairUrl } from './lib/sync.js';
import { DEFAULT_LIMITS } from './lib/srs.js';
import { mountShell } from './lib/shell.js';
import qrcode from './lib/qr.js';

// Settings is a destination in the app, not a detached preferences window, so
// it wears the same navbar as every other page.
mountShell({ active: 'options' });

const DEFAULTS = {
  theme: 'yellow',
  toneColors: true,
  exampleCount: 8,
  examplePinyin: true,
  hanziPref: 'simp-first',
  showHints: true,
  mandarinVoiceId: 'auto',
  voiceRate: 0.95,
  ...DEFAULT_LIMITS,
};

const els = {
  theme: document.getElementById('theme'),
  toneColors: document.getElementById('toneColors'),
  exampleCount: document.getElementById('exampleCount'),
  examplePinyin: document.getElementById('examplePinyin'),
  hanziPref: document.getElementById('hanziPref'),
  showHints: document.getElementById('showHints'),
  mandarinVoice: document.getElementById('mandarinVoice'),
  voiceRate: document.getElementById('voiceRate'),
  newPerDay: document.getElementById('newPerDay'),
  maxPerDay: document.getElementById('maxPerDay'),
};
const voiceRateValue = document.getElementById('voiceRateValue');
const voiceNote = document.getElementById('voiceNote');
const testVoice = document.getElementById('testVoice');

const savedEl = document.getElementById('saved');
let savedTimer = null;

function flashSaved() {
  savedEl.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedEl.classList.remove('show'), 1200);
}

async function load() {
  const [s, voiceResult] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.runtime.sendMessage({ type: 'listVoices' }).catch(() => ({ voices: [] })),
  ]);
  const voices = voiceResult?.voices || [];
  if (voices[0]) {
    els.mandarinVoice.options[0].textContent =
      `Auto — ${voices[0].voiceName} (${voices[0].lang})`;
  }
  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = `${voice.voiceName} (${voice.lang})${voice.recommended ? ' — recommended' : ''}`;
    els.mandarinVoice.append(option);
  }
  if (s.mandarinVoiceId !== 'auto' && !voices.some((v) => v.id === s.mandarinVoiceId)) {
    const missing = document.createElement('option');
    missing.value = s.mandarinVoiceId;
    missing.textContent = 'Previously selected voice (unavailable)';
    els.mandarinVoice.append(missing);
  }
  els.theme.value = s.theme;
  els.toneColors.checked = !!s.toneColors;
  els.exampleCount.value = s.exampleCount;
  els.examplePinyin.checked = !!s.examplePinyin;
  els.hanziPref.value = s.hanziPref;
  els.showHints.checked = !!s.showHints;
  els.mandarinVoice.value = s.mandarinVoiceId;
  els.voiceRate.value = s.voiceRate;
  els.newPerDay.value = s.newPerDay;
  els.maxPerDay.value = s.maxPerDay;
  voiceRateValue.value = `${Number(s.voiceRate).toFixed(2)}×`;
  if (voices.length === 0) {
    voiceNote.textContent = 'Chrome did not report an installed Mandarin voice. Add a Mandarin voice in macOS System Settings, then reload this page.';
  }
}

const clampInt = (value, fallback, min, max) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

async function save() {
  const exampleCount = Math.max(0, Math.min(15, Number(els.exampleCount.value) || 0));
  els.exampleCount.value = exampleCount;
  const newPerDay = clampInt(els.newPerDay.value, DEFAULT_LIMITS.newPerDay, 0, 200);
  const maxPerDay = clampInt(els.maxPerDay.value, DEFAULT_LIMITS.maxPerDay, 1, 1000);
  els.newPerDay.value = newPerDay;
  els.maxPerDay.value = maxPerDay;
  await chrome.storage.sync.set({
    theme: els.theme.value,
    toneColors: els.toneColors.checked,
    exampleCount,
    examplePinyin: els.examplePinyin.checked,
    hanziPref: els.hanziPref.value,
    showHints: els.showHints.checked,
    mandarinVoiceId: els.mandarinVoice.value,
    voiceRate: Number(els.voiceRate.value),
    newPerDay,
    maxPerDay,
  });
  flashSaved();
}

for (const el of Object.values(els)) el.addEventListener('change', save);
els.voiceRate.addEventListener('input', () => {
  voiceRateValue.value = `${Number(els.voiceRate.value).toFixed(2)}×`;
});
// ---------------------------------------------------------------------------
// AI key
//
// One key for the news digest, the tutor, and card translation. Kept out of
// `els`/`save()` above because it is a credential, not a preference: it is
// written on its own, never round-tripped through a bulk save, and the field
// shows a masked hint rather than the value once it is set.
// ---------------------------------------------------------------------------

const aiKeyEl = document.getElementById('aiKey');
const aiKeyStatus = document.getElementById('aiKeyStatus');

const maskKey = (key) =>
  (key.length <= 12 ? key : `${key.slice(0, 6)}…${key.slice(-4)}`);

async function renderAiKey() {
  const key = await getAiKey();
  aiKeyEl.value = key;
  aiKeyStatus.textContent = key ? `Saved (${maskKey(key)})` : 'Not set — AI features are off';
}

aiKeyEl.addEventListener('change', async () => {
  const key = aiKeyEl.value.trim();
  // Only shapes the Worker will accept, caught here so the first failure is a
  // sentence in the options page rather than a 400 inside the news tab.
  if (key && !/^sk-[A-Za-z0-9_-]{16,256}$/.test(key) && !/^[0-9a-f-]{8,64}:[0-9a-f]{16,64}$/i.test(key)) {
    aiKeyStatus.textContent = 'That does not look like an OpenAI (sk-…) or fal.ai key';
    return;
  }
  await chrome.storage.local.set({ aiKey: key });
  await renderAiKey();
  flashSaved();
});

renderAiKey();

// ---------------------------------------------------------------------------
// Phone sync pairing
// ---------------------------------------------------------------------------

const syncEls = {
  setup: document.getElementById('syncSetup'),
  paired: document.getElementById('syncPaired'),
  server: document.getElementById('syncServer'),
  enable: document.getElementById('syncEnable'),
  qr: document.getElementById('syncQr'),
  token: document.getElementById('syncToken'),
  link: document.getElementById('syncLink'),
  now: document.getElementById('syncNowBtn'),
  rotate: document.getElementById('syncRotate'),
  disable: document.getElementById('syncDisable'),
  status: document.getElementById('syncStatus'),
};

function fmtAgo(ts) {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

async function renderSync() {
  const meta = await getSyncMeta();
  const paired = !!(meta && meta.token && meta.serverUrl);
  syncEls.setup.hidden = paired;
  syncEls.paired.hidden = !paired;
  if (!paired) {
    if (!syncEls.server.value) syncEls.server.value = DEFAULT_SERVER_URL;
    return;
  }
  const url = pairUrl(meta);
  const qr = qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  syncEls.qr.src = qr.createDataURL(4, 8);
  syncEls.token.textContent = meta.token;
  syncEls.link.textContent = meta.serverUrl;
  syncEls.link.href = meta.serverUrl;
  syncEls.status.textContent = `Last synced: ${fmtAgo(meta.lastSyncAt)}`;
}

syncEls.enable.addEventListener('click', async () => {
  const serverUrl = syncEls.server.value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/.test(serverUrl)) {
    syncEls.server.focus();
    return;
  }
  await chrome.storage.local.set({
    syncMeta: { token: newToken(), serverUrl, cursor: 0, lastPushAt: 0 },
  });
  chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});
  renderSync();
});

syncEls.now.addEventListener('click', async () => {
  syncEls.status.textContent = 'Syncing…';
  const result = await chrome.runtime.sendMessage({ type: 'syncNow' })
    .catch((error) => ({ ok: false, reason: String(error) }));
  syncEls.status.textContent = result?.ok
    ? `Synced ✓ (${result.pushed} sent, ${result.pulled} received)`
    : `Sync failed: ${result?.reason || 'unknown'}`;
});

syncEls.rotate.addEventListener('click', async () => {
  if (!confirm('Rotate the pairing code? Your phone will stop syncing until you scan the new code.')) return;
  const meta = await getSyncMeta();
  // A new token is a new server-side deck; resetting the cursors re-pushes
  // every card to it on the next sync.
  await chrome.storage.local.set({
    syncMeta: { ...meta, token: newToken(), cursor: 0, lastPushAt: 0 },
  });
  chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});
  renderSync();
});

syncEls.disable.addEventListener('click', async () => {
  if (!confirm('Turn off phone sync? Cards stay on this computer and on the server; syncing just stops.')) return;
  await chrome.storage.local.remove('syncMeta');
  renderSync();
});

renderSync();

testVoice.addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({
    type: 'speak',
    text: '你好，我很高兴认识你。今天天气怎么样？',
    voiceId: els.mandarinVoice.value,
    rate: Number(els.voiceRate.value),
  }).catch((error) => ({ error: String(error) }));
  voiceNote.textContent = result?.error
    ? `Could not play this voice: ${result.error}`
    : `Playing ${result.voice} (${result.lang}).`;
});
load();
