/* Upload selected server-only values through stdin; never print their contents. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const { namespace } = require('../src/server/map-config.cjs');
const root = path.resolve(__dirname, '..');
const env = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
const project = JSON.parse(fs.readFileSync(path.join(root, '.vercel/project.json'), 'utf8'));
let phrases;
try { phrases = JSON.parse(env.CAMPAIGN_PASSPHRASES); } catch (_) {}
if (!Array.isArray(phrases) || !phrases.length || phrases.some(p => typeof p !== 'string' || p.length < 8 || p.length > 512) || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('Set a valid passphrase list and session secret in .env first.');
const values = { CAMPAIGN_PASSPHRASES: env.CAMPAIGN_PASSPHRASES, SESSION_SECRET: env.SESSION_SECRET, CAMPAIGN_ID: namespace(env), CAMPAIGN_STORE: 'redis', CAMPAIGN_MAP_REQUIRED: '1' };
for (const key of Object.keys(values)) {
  const result = spawnSync('vercel', ['env', 'add', key, '--environment', 'production', '--force', '--yes', '--sensitive', '--scope', project.orgId, '--project', project.projectId], { cwd: root, input: values[key], encoding: 'utf8' });
  if (result.status !== 0) { console.error(`Could not upload ${key}. Check Vercel CLI authentication and retry.`); process.exit(1); }
  console.log(`Updated ${key} for Production.`);
}
console.log('Redeploy to activate these environment changes.');
