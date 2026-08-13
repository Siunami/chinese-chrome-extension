// Checks that a DEPLOYED Worker actually serves every route the extension
// calls. Everything else in tests/ imports worker/src/index.js and runs it in
// Node, which passes happily while the live Worker serves an older bundle —
// exactly how /api/ask shipped, was documented, and 404'd in the browser.
//
// Sends no credentials and no user data: an unauthenticated POST to a route
// that exists is rejected with 401/400/405, while a route the deployed bundle
// has never heard of falls through to the Worker's catch-all 404. That
// difference is the whole test.
//
// Usage: node scripts/worker-smoke.mjs [baseUrl]
//   defaults to the DEFAULT_SERVER_URL the extension ships with.

import { DEFAULT_SERVER_URL } from '../extension/lib/sync.js';

const base = (process.argv[2] || DEFAULT_SERVER_URL).replace(/\/+$/, '');

// Every route the clients call, and how a deployed Worker should answer an
// unauthenticated request to it. 404 always means "this deployment predates
// the route" — the asset handler never sees /api/* (run_worker_first).
const ROUTES = [
  { path: '/api/health', method: 'GET', expect: [200] },
  { path: '/api/sync', method: 'POST', expect: [401] },
  { path: '/api/news', method: 'POST', expect: [401] },
  { path: '/api/ask', method: 'POST', expect: [401] },
  { path: '/api/placement', method: 'POST', expect: [401] },
  { path: '/api/translate', method: 'POST', expect: [401] },
];

console.log(`worker-smoke: ${base}\n`);

let failed = 0;
for (const route of ROUTES) {
  let status = 0;
  let body = '';
  try {
    const res = await fetch(`${base}${route.path}`, {
      method: route.method,
      headers: { 'content-type': 'application/json' },
      body: route.method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(20000),
    });
    status = res.status;
    body = (await res.text()).slice(0, 90).replace(/\s+/g, ' ');
  } catch (err) {
    console.log(`  FAIL  ${route.path.padEnd(16)} unreachable: ${err.message}`);
    failed++;
    continue;
  }

  if (route.expect.includes(status)) {
    console.log(`  ok    ${route.path.padEnd(16)} ${status}`);
    continue;
  }
  failed++;
  const why = status === 404
    ? 'route missing — this Worker is older than the code. Run: cd worker && npx wrangler deploy'
    : `expected ${route.expect.join('/')}, got ${status}: ${body}`;
  console.log(`  FAIL  ${route.path.padEnd(16)} ${why}`);
}

console.log();
if (failed) {
  console.error(`worker-smoke: ${failed} route(s) not serving as expected`);
  process.exit(1);
}
console.log('worker-smoke: every route is deployed');
