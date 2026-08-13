// Web Speech in place of chrome.tts; ships with Mandarin voices on both
// Android and iOS. Shared by the review view and the word-detail sheet.

export function speak(text, slow) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  const voice = speechSynthesis.getVoices()
    .filter((v) => /^zh([-_]|$)/i.test(v.lang))
    .sort((a, b) => (b.localService ? 1 : 0) - (a.localService ? 1 : 0))[0];
  if (voice) utterance.voice = voice;
  utterance.rate = slow ? 0.6 : 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}
