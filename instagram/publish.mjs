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
    const url = f => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${f}`;
    const collab = post.collaborators?.length ? { collaborators: JSON.stringify(post.collaborators) } : {};
    console.log(`Publicant ${file}…`);
    let creation_id;
    if (post.images?.length > 1) {
      // Carrusel: "images": ["ruta1.jpg", "ruta2.jpg", ...] (2-10 imatges)
      const children = [];
      for (const img of post.images) {
        const { id: child } = await call(`${IG_USER_ID}/media`, { image_url: url(img), is_carousel_item: 'true' });
        await waitUntilReady(child);
        children.push(child);
      }
      ({ id: creation_id } = await call(`${IG_USER_ID}/media`, {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption: post.caption,
        ...collab,
      }));
    } else {
      ({ id: creation_id } = await call(`${IG_USER_ID}/media`, {
        image_url: url(post.image || post.images[0]),
        caption: post.caption,
        // opcional: "collaborators": ["usuari_sponsor"] → invitació de publicació en col·laboració (màx. 3)
        ...collab,
      }));
    }
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
