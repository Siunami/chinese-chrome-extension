import {
  DEFAULT_SERVER_URL, getAiKey, getSyncMeta, newToken, pairUrl, pairWith,
} from './lib/sync.js';
import {
  AI_BAD_KEY, AI_NO_KEY, AI_NO_QUOTA, AI_NOTICES, AI_UNPAIRED,
  clearAiFailure, getAiStatus, onAiStatus,
} from './lib/aistatus.js';
import { DEFAULT_LIMITS } from './lib/srs.js';
import {
  buildBackup, joinList, labelFor, planRestore, readBackup, restoreOrder, summarizeBackup,
} from './lib/backup.js';
import { mountShell } from './lib/shell.js';
import { onHanziPref } from './lib/hanzi.js';
import qrcode from './lib/qr.js';

// Settings is a destination in the app, not a detached preferences window, so
// it wears the same navbar as every other page.
mountShell({ active: 'options' });

// The navbar's 简/繁 toggle and the Character preference dropdown below are the
// same setting, and on this page they are both on screen. Flipping one has to
// move the other, or the page contradicts itself.
onHanziPref((pref) => { els.hanziPref.value = pref; });

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

// Put a settings object on screen. Separate from load() because a restore
// hands the page a whole new set of values while the voice list is already
// built, and re-running load() would append that list to itself.
function showSettings(s) {
  els.theme.value = s.theme;
  els.toneColors.checked = !!s.toneColors;
  els.exampleCount.value = s.exampleCount;
  els.examplePinyin.checked = !!s.examplePinyin;
  els.hanziPref.value = s.hanziPref;
  els.showHints.checked = !!s.showHints;
  els.mandarinVoice.value = s.mandarinVoiceId;
  // A voice chosen on another Mac, or one since removed from this one: the
  // assignment above silently does nothing, leaving the dropdown showing a
  // voice that is not the saved setting. Name it instead.
  if (els.mandarinVoice.value !== s.mandarinVoiceId) {
    const missing = document.createElement('option');
    missing.value = s.mandarinVoiceId;
    missing.textContent = 'Previously selected voice (unavailable)';
    els.mandarinVoice.append(missing);
    els.mandarinVoice.value = s.mandarinVoiceId;
  }
  els.voiceRate.value = s.voiceRate;
  els.newPerDay.value = s.newPerDay;
  els.maxPerDay.value = s.maxPerDay;
  voiceRateValue.value = `${Number(s.voiceRate).toFixed(2)}×`;
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
  showSettings(s);
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

// The field says what the app knows: not only whether a key is saved, but
// whether the provider has since refused it. A key that looks perfectly fine
// here while every AI feature fails is the state this page used to show.
async function renderAiKey() {
  const key = await getAiKey();
  const status = await getAiStatus();
  aiKeyEl.value = key;
  aiKeyStatus.classList.toggle('warn',
    [AI_BAD_KEY, AI_NO_KEY, AI_NO_QUOTA].includes(status.code));
  if (status.code === AI_BAD_KEY || status.code === AI_NO_QUOTA) {
    aiKeyStatus.textContent = `${AI_NOTICES[status.code].label} — ${AI_NOTICES[status.code].detail}`;
    return;
  }
  if (!key) {
    // A deployment that pays for its own calls does not need one, and telling
    // someone their features are off when they are not is worse than silence.
    // With no server paired there is nothing to have asked, so it says the
    // neutral thing rather than guessing either way.
    aiKeyStatus.textContent = status.code === AI_NO_KEY
      ? 'Not set — the tutor, news, placement and translation are off until you add one'
      : status.code === AI_UNPAIRED
        ? 'Not set — add one to turn on the tutor, news, placement and translation'
        : 'Not set — this server supplies its own key, so the AI features still work';
    return;
  }
  aiKeyStatus.textContent = `Saved (${maskKey(key)})`;
}

aiKeyEl.addEventListener('change', async () => {
  const key = aiKeyEl.value.trim();
  // Only shapes the Worker will accept, caught here so the first failure is a
  // sentence in the options page rather than a 400 inside the news tab.
  if (key && !/^sk-[A-Za-z0-9_-]{16,256}$/.test(key) && !/^[0-9a-f-]{8,64}:[0-9a-f]{16,64}$/i.test(key)) {
    aiKeyStatus.classList.add('warn');
    aiKeyStatus.textContent = 'That does not look like an OpenAI (sk-…) or fal.ai key';
    return;
  }
  await chrome.storage.local.set({ aiKey: key });
  // Whatever the provider said about the last key is not evidence about this
  // one; leaving it up would show "rejected" over a key nobody has tried yet.
  await clearAiFailure();
  await renderAiKey();
  flashSaved();
});

renderAiKey();
onAiStatus(renderAiKey);

// Arriving from the navbar's notice, which names the thing to fix rather than
// the page it is on. Land on that section with the field focused — the point
// of pressing it was to deal with what it said.
function goToTarget() {
  const target = document.getElementById(location.hash.slice(1));
  if (!target) return;
  target.scrollIntoView({ block: 'start', behavior: 'instant' });
  target.classList.add('called-out');
  setTimeout(() => target.classList.remove('called-out'), 2000);
  if (target.id === 'ai') aiKeyEl.focus();
}
addEventListener('hashchange', goToTarget);
// Not during module execution: a focus() call made before the page has laid
// itself out is dropped silently, with no error and no focus event, so the
// learner lands on the right section with the cursor nowhere. One frame after
// load is late enough to take and early enough that nobody sees the page
// before it moves.
if (document.readyState === 'complete') requestAnimationFrame(goToTarget);
else addEventListener('load', () => requestAnimationFrame(goToTarget));

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
  // pairWith does the validating, so a URL typed here and one baked into a
  // self-hosted build are accepted on exactly the same terms.
  if (!await pairWith(syncEls.server.value)) {
    syncEls.server.focus();
    return;
  }
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

// ---------------------------------------------------------------------------
// Backup and restore
//
// The storage reads, the download, and the file picker. What belongs in a
// backup and what a restore means to each kind of state is lib/backup.js.
// ---------------------------------------------------------------------------

const backupEls = {
  usage: document.getElementById('backupUsage'),
  secrets: document.getElementById('backupSecrets'),
  download: document.getElementById('backupDownload'),
  restore: document.getElementById('backupRestore'),
  file: document.getElementById('backupFile'),
  status: document.getElementById('backupStatus'),
};

function setBackupStatus(text, warn = false) {
  backupEls.status.textContent = text;
  backupEls.status.classList.toggle('warn', warn);
}

const fmtBytes = (n) => (n < 1024 * 1024
  ? `${Math.max(1, Math.round(n / 1024))} KB`
  : `${(n / (1024 * 1024)).toFixed(1)} MB`);

// How much of this browser the app is using. The number the learner would want
// before deciding whether any of this matters — and the size of the file the
// button above is about to write.
async function renderUsage() {
  try {
    const bytes = await chrome.storage.local.getBytesInUse(null);
    backupEls.usage.textContent =
      `This browser is holding ${fmtBytes(bytes)} of your learning, which is roughly `
      + 'what the file will weigh.';
  } catch {
    // Not every context reports it; the section works fine without the number.
    backupEls.usage.textContent = '';
  }
}

// One write for the ordinary case, and a key-at-a-time retry when the browser
// refuses it. A restore is the one moment the app writes everything at once, so
// it is also the one moment a single oversized value can take the deck down
// with it — see restoreOrder for what goes back first.
async function writeArea(area, values) {
  if (!Object.keys(values).length) return [];
  try {
    await chrome.storage[area].set(values);
    return [];
  } catch {
    const skipped = [];
    for (const key of restoreOrder(values)) {
      try {
        await chrome.storage[area].set({ [key]: values[key] });
      } catch {
        skipped.push(key);
      }
    }
    return skipped;
  }
}

backupEls.download.addEventListener('click', async () => {
  // `null` rather than a list of keys: whatever this install has stored is
  // what the file gets, including state written by a version of the extension
  // this code has never heard of.
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(null),
    chrome.storage.local.get(null),
  ]);
  const includeSecrets = backupEls.secrets.checked;
  const backup = buildBackup({ sync, local }, {
    includeSecrets,
    now: Date.now(),
    extensionVersion: chrome.runtime.getManifest().version,
  });
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Dated, because the point of these is to have more than one.
  a.download = `zhongwen-explorer-backup-${new Date(backup.createdAt).toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setBackupStatus(`Saved ${summarizeBackup(backup)} — ${fmtBytes(blob.size)}.`
    + (includeSecrets ? '' : ' The API key and pairing code were left out, so restoring'
      + ' this file will not change either.'));
  flashSaved();
});

backupEls.restore.addEventListener('click', () => backupEls.file.click());

backupEls.file.addEventListener('change', async () => {
  const file = backupEls.file.files?.[0];
  // Reset first: picking the same file twice in a row must re-run the restore.
  backupEls.file.value = '';
  if (!file) return;

  let backup;
  try {
    backup = readBackup(await file.text());
  } catch (err) {
    setBackupStatus(err.message, true);
    return;
  }

  const when = backup.createdAt
    ? `backed up ${new Date(backup.createdAt).toLocaleString()}`
    : 'from an unknown date';
  if (!confirm(`Restore ${summarizeBackup(backup)}, ${when}?\n\n`
    + 'Saved cards are merged with the ones on this computer, so nothing you have '
    + 'saved or reviewed since is lost. Settings, news, placement results and tutor '
    + 'conversations are replaced by the file.')) {
    setBackupStatus('Restore cancelled — nothing was changed.');
    return;
  }

  // Read the deck now rather than trusting anything from before the dialog: a
  // sync or another tab may have changed it while the confirmation was up.
  const current = await chrome.storage.local.get(['wordlist', 'tombstones']);
  const plan = planRestore(backup, current, Date.now());
  const skipped = [
    ...await writeArea('sync', plan.sync),
    ...await writeArea('local', plan.local),
  ];
  chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});

  showSettings(await chrome.storage.sync.get(DEFAULTS));
  renderAiKey();
  renderSync();
  renderUsage();
  // Counted from storage rather than from the plan: if something did not go in,
  // the number has to be what is actually there.
  const { wordlist = [] } = await chrome.storage.local.get('wordlist');
  const restored = `Restored. Your library now has ${wordlist.length} `
    + `card${wordlist.length === 1 ? '' : 's'}.`;
  setBackupStatus(skipped.length
    ? `${restored} This browser would not store ${joinList(skipped.map(labelFor))} — it is `
      + 'out of room, so that much of the backup is still only in the file.'
    : restored, skipped.length > 0);
  flashSaved();
});

renderUsage();

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
