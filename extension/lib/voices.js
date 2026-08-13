// Ranking and stable identity for Mandarin voices exposed by chrome.tts.

export function normalizeLang(value) {
  return String(value || '').toLowerCase().replaceAll('_', '-');
}

export function voiceId(voice) {
  // JSON is safe to use as a <select> value and avoids collisions between
  // voices with the same display name provided by different engines.
  return JSON.stringify([
    voice.extensionId || '', voice.voiceName || '', normalizeLang(voice.lang),
  ]);
}

export function mandarinVoiceScore(voice) {
  const lang = normalizeLang(voice.lang);
  const name = String(voice.voiceName || '').toLowerCase();
  let score = 0;

  // Prefer Mainland Mandarin for the simplified-Chinese dictionary, while
  // retaining Taiwan and Singapore Mandarin as useful fallbacks.
  if (lang === 'zh-cn' || lang === 'cmn-cn' || lang === 'zh-hans') score += 500;
  else if (lang === 'zh-sg' || lang === 'cmn') score += 460;
  else if (lang === 'zh-tw' || lang === 'cmn-tw') score += 420;
  else if (lang.startsWith('zh') || lang.startsWith('cmn')) score += 300;
  else return -1;

  // Voice engines do not expose a standardized quality field, so their
  // descriptive names are the only portable quality signal available.
  if (/neural|premium|enhanced|natural/.test(name)) score += 120;
  if (/xiaoxiao|xiaoyi|ting[ -]?ting|tingting|yu[ -]?shu|yushu/.test(name)) score += 100;
  if (/microsoft/.test(name)) score += 70;
  if (/google/.test(name)) score += 60;
  if (/siri/.test(name)) score += 50;
  if (/compact/.test(name)) score -= 40;
  if (voice.remote) score += 15;
  return score;
}

export function sortedMandarinVoices(voices) {
  return [...voices]
    .filter((voice) => mandarinVoiceScore(voice) >= 0 && voice.voiceName)
    .sort((a, b) => mandarinVoiceScore(b) - mandarinVoiceScore(a) ||
      String(a.voiceName).localeCompare(String(b.voiceName)));
}

export function pickMandarinVoice(voices, preferredId = 'auto') {
  const candidates = sortedMandarinVoices(voices);
  if (preferredId && preferredId !== 'auto') {
    const selected = candidates.find((voice) => voiceId(voice) === preferredId);
    if (selected) return selected;
  }
  return candidates[0] || null;
}
