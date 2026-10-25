import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({input,output});
async function prompt(message){ return (await rl.question(message)).trim(); }
try {
  console.log('\nSUMMONER v39 - Cloudflare Server Recovery');
  console.log('This updates the EXISTING Cloudflare Worker. GitHub v39 must be uploaded separately.\n');
  const workerText = await prompt('Existing Cloudflare Workers URL (https://...workers.dev): ');
  let worker;
  try { worker = new URL(workerText); } catch { throw new Error('Cloudflare URL is invalid.'); }
  const host = worker.hostname.toLowerCase();
  const parts = host.split('.');
  if (worker.protocol !== 'https:' || parts.length < 4 || parts.slice(-2).join('.') !== 'workers.dev') {
    throw new Error('Enter the existing https://<worker>.<account>.workers.dev URL. For custom domains, use your original Worker name manually in wrangler.toml.');
  }
  const workerName = parts[0];
  if (!/^[a-z0-9-]+$/.test(workerName) || workerName.startsWith('-') || workerName.endsWith('-')) {
    throw new Error('Could not read valid Worker name from URL.');
  }
  const githubText = await prompt('GitHub Pages URL (https://username.github.io/your-repo/): ');
  let github;
  try { github = new URL(githubText); } catch { throw new Error('GitHub Pages URL is invalid.'); }
  if (github.protocol !== 'https:' || !github.hostname.includes('.')) {
    throw new Error('GitHub Pages URL must start with https://');
  }
  const origin = github.origin;
  console.log('\nCloudflare Worker name: ' + workerName);
  console.log('Cloudflare URL:         ' + worker.origin);
  console.log('Allowed website origin: ' + origin);
  console.log('\nIMPORTANT: check Worker name matches your existing Cloudflare dashboard.');
  const confirm = await prompt('Deploy with these settings? Enter YES to continue: ');
  if (confirm !== 'YES') { console.log('Cancelled. Nothing was changed.'); process.exitCode = 2; }
  else {
    const file = path.join(import.meta.dirname, 'online-server', 'wrangler.toml');
    let cfg = await fs.readFile(file,'utf8');
    if (!/^name\s*=\s*"[^"]*"/m.test(cfg)) throw new Error('wrangler.toml is missing name');
    if (!/^ALLOWED_ORIGINS\s*=\s*"[^"]*"/m.test(cfg)) throw new Error('wrangler.toml is missing ALLOWED_ORIGINS');
    cfg = cfg.replace(/^name\s*=\s*"[^"]*"/m, `name = "${workerName}"`);
    cfg = cfg.replace(/^ALLOWED_ORIGINS\s*=\s*"[^"]*"/m, `ALLOWED_ORIGINS = "${origin}"`);
    await fs.writeFile(file,cfg,'utf8');
    await fs.writeFile(path.join(import.meta.dirname,'CHECK_VERSION_URL.txt'),worker.origin+'/health\n','utf8');
    console.log('\nConfiguration saved. Returning to deploy script.');
  }
} catch (error) { console.error('\nERROR: ' + error.message); process.exitCode = 1; }
finally { rl.close(); }
