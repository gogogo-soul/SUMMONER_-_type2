import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const home = path.dirname(fileURLToPath(import.meta.url));
const expected = 'alpha2-v40-triggerfix-20261026';
try {
  const urlText = (await readFile(path.join(home, 'CHECK_VERSION_URL.txt'), 'utf8')).trim();
  const url = new URL(urlText);
  if (url.protocol !== 'https:' || url.pathname !== '/health') {
    throw new Error('The saved URL must be https://YOUR-WORKER.workers.dev/health');
  }
  // Prevent cached health responses during a repeated deployment test.
  url.searchParams.set('_verify', Date.now().toString());
  console.log(`\nChecking published Worker: ${url.origin}/health`);
  const response = await fetch(url, {
    headers: {'cache-control':'no-cache'},
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { throw new Error(`Non-JSON response (${response.status}): ${body.slice(0,350)}`); }
  console.log(`HTTP status: ${response.status}`);
  console.log(`Live version: ${parsed.version ?? '(missing)'}`);
  console.log(`Expected:     ${expected}`);
  if (!response.ok || parsed.version !== expected) {
    console.error('\nVERSION MISMATCH: Deployment is not serving v40 at the original Worker URL.');
    console.error('1. Compare the published URL printed by Wrangler with this URL.');
    console.error('2. Make sure Wrangler is logged into the same Cloudflare account as the original Worker.');
    console.error('3. Check any errors printed earlier during deployment.');
    process.exitCode = 2;
  } else {
    console.log('\nSUCCESS: The original Cloudflare Worker now serves alpha2-v40-triggerfix-20261026.');
  }
} catch (error) {
  console.error(`\nHEALTH CHECK FAILED: ${error.message}`);
  console.error('Check the Worker URL, your network connection, and Wrangler deploy output.');
  process.exitCode = 1;
}
