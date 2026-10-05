// Publica a Instagram les peces de instagram/queue/*.json amb "ready": true i sense "published".
// Necessita les variables d'entorn IG_USER_ID i IG_ACCESS_TOKEN (secrets de GitHub).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const QUEUE = 'instagram/queue';
const REPO = process.env.GITHUB_REPOSITORY || 'Catachun/Liga-TT-Joves-Castelldefels';
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const API = 'https://graph.instagram.com/v21.0';
const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;

if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
  console.error('Falten els secrets IG_USER_ID i/o IG_ACCESS_TOKEN.');
  process.exit(1);
}

async function call(path, params) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, access_token: IG_ACCESS_TOKEN }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(JSON.stringify(data.error || data));
  return data;
}

async function waitUntilReady(containerId) {
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${API}/${containerId}?fields=status_code&access_token=${IG_ACCESS_TOKEN}`);
    const { status_code } = await res.json();
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`Contenidor ${status_code}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Temps d\'espera esgotat processant la imatge');
}

let failed = false;
for (const file of readdirSync(QUEUE).filter(f => f.endsWith('.json')).sort()) {
  const path = join(QUEUE, file);
  const post = JSON.parse(readFileSync(path, 'utf8'));
  if (!post.ready || post.published) continue;
  try {
    const image_url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${post.image}`;
    console.log(`Publicant ${file}…`);
    const { id: creation_id } = await call(`${IG_USER_ID}/media`, { image_url, caption: post.caption });
    await waitUntilReady(creation_id);
    const { id } = await call(`${IG_USER_ID}/media_publish`, { creation_id });
    post.published = { id, date: new Date().toISOString() };
    writeFileSync(path, JSON.stringify(post, null, 2) + '\n');
    console.log(`✅ Publicat (media id ${id})`);
  } catch (e) {
    failed = true;
    console.error(`❌ Error amb ${file}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
