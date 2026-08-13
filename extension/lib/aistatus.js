// Whether the AI features can work right now, and one way to call them.
//
// Four features run on a model — the tutor, the news digest, the placement
// interview, and card translation — and every one of them used to discover a
// missing or rejected API key the same way: by failing, inside itself, with a
// sentence only that page showed. A learner who had never pasted a key met
// "could not reach the examiner" and had nothing to act on. The state belongs
// to the app, not to whichever page happened to ask first, so it lives here
// and the navbar (lib/shell.js) wears it.
//
// Two facts decide it, and neither costs a model call:
//
//   the deployment  /api/health says whether the server has a provider key of
//                   its own and whether it expects the caller to bring one. A
//                   server that pays for its own calls must not nag anyone to
//                   paste a key they do not need, and that is not something a
//                   client can guess.
//   the last try    a provider that rejected the key says so with
//                   code: 'provider_auth', which is a different fact from a
//                   provider having a bad afternoon. Only the first is worth
//                   putting in front of the learner.

import { aiHeaders, getAiKey, getSyncMeta } from './sync.js';

export const AI_OK = 'ok';
export const AI_NO_KEY = 'no-key';        // nobody is paying for the call
export const AI_BAD_KEY = 'bad-key';      // a key is set and the provider refused it
export const AI_NO_QUOTA = 'no-quota';    // a real key, out of credit
export const AI_UNPAIRED = 'unpaired';    // no server to ask at all
export const AI_STALE_SERVER = 'stale';   // the Worker predates the route being called

const STATE_KEY = 'aiState';    // { code, at, detail }
const HEALTH_KEY = 'aiHealth';  // { at, serverUrl, configured, requiresUserKey }
const HEALTH_TTL_MS = 6 * 60 * 60 * 1000;

// What the navbar says, and what pressing it should do about it.
export const AI_NOTICES = {
  [AI_NO_KEY]: {
    label: 'Add your API key',
    detail: 'The tutor, the news digest and the placement interview run on your own '
      + 'AI API key. Everything else works without one.',
    target: 'ai',
  },
  [AI_BAD_KEY]: {
    label: 'API key was rejected',
    detail: 'The AI provider refused the key saved in this browser. Check it, or paste '
      + 'a new one.',
    target: 'ai',
  },
  [AI_NO_QUOTA]: {
    label: 'API key is out of credit',
    detail: 'The AI provider says this key has no quota left. Check its billing, or '
      + 'paste a different key.',
    target: 'ai',
  },
  [AI_STALE_SERVER]: {
    label: 'Sync server is out of date',
    detail: 'This server is running an older build than the extension and does not have '
      + 'every feature yet. Redeploy it (cd worker && npx wrangler deploy), or point the '
      + 'extension at another one.',
    target: 'sync',
  },
};

// ---------------------------------------------------------------------------
// Reading and writing the state
// ---------------------------------------------------------------------------

async function readState() {
  const { [STATE_KEY]: state } = await chrome.storage.local.get(STATE_KEY);
  return state && typeof state === 'object' ? state : null;
}

async function writeState(code, detail = '') {
  const current = await readState();
  // Writing the same verdict again would wake every storage listener in every
  // open tab for nothing.
  if (current && current.code === code) return;
  if (code === AI_OK) {
    if (!current) return;
    await chrome.storage.local.remove(STATE_KEY);
    return;
  }
  await chrome.storage.local.set({ [STATE_KEY]: { code, detail, at: Date.now() } });
}

// The deployment's own answer, cached: it changes when someone redeploys, not
// between page loads. A probe that fails leaves the previous answer alone —
// being offline is not evidence about anybody's API key.
async function health(meta, { fresh = false } = {}) {
  const { [HEALTH_KEY]: cached } = await chrome.storage.local.get(HEALTH_KEY);
  const usable = cached && cached.serverUrl === meta.serverUrl
    && Date.now() - (cached.at || 0) < HEALTH_TTL_MS;
  if (usable && !fresh) return cached;

  try {
    const res = await fetch(`${meta.serverUrl.replace(/\/+$/, '')}/api/health`);
    const data = await res.json();
    const next = {
      at: Date.now(),
      serverUrl: meta.serverUrl,
      // A server too old to report `ai` at all is assumed to be paying its own
      // way; it predates the field, not the feature, and guessing the other way
      // would nag every user of an older deployment.
      configured: data.ai ? !!data.ai.configured : true,
      requiresUserKey: data.ai ? !!data.ai.requiresUserKey : false,
    };
    await chrome.storage.local.set({ [HEALTH_KEY]: next });
    return next;
  } catch {
    return cached || null;
  }
}

/**
 * The current verdict. `{ code, detail }`, where code is one of the AI_*
 * constants. Cheap: at most one cached GET.
 */
export async function getAiStatus({ fresh = false } = {}) {
  const meta = await getSyncMeta();
  if (!meta || !meta.token || !meta.serverUrl) return { code: AI_UNPAIRED, detail: '' };

  // A recorded failure outranks anything derived: the provider has actually
  // spoken, and it said no.
  const state = await readState();
  if (state && (state.code === AI_BAD_KEY || state.code === AI_NO_QUOTA
    || state.code === AI_STALE_SERVER)) {
    return state;
  }

  const key = await getAiKey();
  if (key) return { code: AI_OK, detail: '' };

  const deployment = await health(meta, { fresh });
  if (!deployment) return { code: AI_OK, detail: '' }; // unreachable: say nothing
  if (deployment.requiresUserKey || !deployment.configured) {
    return { code: AI_NO_KEY, detail: '' };
  }
  return { code: AI_OK, detail: '' };
}

// Re-run the verdict whenever anything it is derived from moves: the key, the
// pairing, the recorded failure.
export function onAiStatus(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STATE_KEY] || changes.aiKey || changes.syncMeta || changes[HEALTH_KEY]) {
      getAiStatus().then(callback);
    }
  });
}

// A key was just changed in Options. Whatever the provider said about the old
// one is not evidence about this one, and leaving the old verdict up would show
// "rejected" over a key nobody has tried yet.
export async function clearAiFailure() {
  const state = await readState();
  if (state && state.code !== AI_STALE_SERVER) await chrome.storage.local.remove(STATE_KEY);
}

// ---------------------------------------------------------------------------
// Calling a model-backed endpoint
// ---------------------------------------------------------------------------

export class AiError extends Error {
  // `status` is the HTTP status the Worker answered with, or 0 when the request
  // never got there. The translation sweep decides from it whether a card is
  // worth retrying, so it has to survive the trip through here.
  constructor(message, code, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * POST to one of the Worker's model-backed endpoints, and record what the
 * answer says about the key while doing it.
 *
 *   meta     from getSyncMeta(); the caller has already checked it exists
 *   path     '/api/ask', '/api/placement', …
 *   payload  the request body
 *
 * Throws AiError with `code` set for the failures a learner can act on. Every
 * caller used to hand-roll this fetch, which is why a 404 from an out-of-date
 * Worker reached the screen as the word "not found".
 */
export async function postAi(meta, path, payload) {
  const url = `${meta.serverUrl.replace(/\/+$/, '')}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: await aiHeaders(meta),
      body: JSON.stringify(payload),
    });
  } catch {
    // Offline, or no such host. Not a verdict about the key.
    throw new AiError('could not reach the server — check your connection', 'offline', 0);
  }

  // The Worker's catch-all. Every /api/* path it knows answers 401 without a
  // token and 400 with a bad body, so a 404 means this deployment is older
  // than the extension calling it — which is exactly what shipped /api/ask,
  // and then /api/placement, into a wall.
  if (res.status === 404) {
    await writeState(AI_STALE_SERVER);
    throw new AiError(AI_NOTICES[AI_STALE_SERVER].detail, AI_STALE_SERVER, 404);
  }

  const data = await res.json().catch(() => null);

  if (res.ok && data && !data.error) {
    // It worked, so any standing complaint about the key is out of date.
    await writeState(AI_OK);
    return data;
  }

  const message = data?.error || `server error (http ${res.status})`;
  if (data?.code === 'provider_auth') {
    await writeState(AI_BAD_KEY, message);
    throw new AiError(message, AI_BAD_KEY, res.status);
  }
  if (data?.code === 'provider_quota') {
    await writeState(AI_NO_QUOTA, message);
    throw new AiError(message, AI_NO_QUOTA, res.status);
  }
  // 503 is resolveModel's "this deployment has no key and expects yours", which
  // is the no-key case arriving the slow way — a learner who never pasted one
  // and whose health probe was unreachable at the time.
  if (res.status === 503) {
    await writeState(AI_NO_KEY, message);
    throw new AiError(message, AI_NO_KEY, res.status);
  }
  throw new AiError(data?.detail || message, data?.code || `http_${res.status}`, res.status);
}
