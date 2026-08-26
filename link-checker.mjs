import { readFileSync } from 'node:fs';

const HTML_FILE = process.env.HTML_FILE || 'index.html';
const TG_TOKEN  = process.env.TG_BOT_TOKEN || '';
const TG_CHAT   = process.env.TG_CHAT_ID || '';
const RESUME_URL = process.env.RESUME_URL ||
  (process.env.GITHUB_REPOSITORY ? `https://${process.env.GITHUB_REPOSITORY.split('/')[0]}.github.io/${process.env.GITHUB_REPOSITORY.split('/')[1]}/` : '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

let html;
if (/^https?:\/\//i.test(HTML_FILE)) {
  html = await (await fetch(HTML_FILE, { headers: { 'User-Agent': UA } })).text();
} else {
  html = readFileSync(HTML_FILE, 'utf8');
}

const urls = new Set(); let m;
const re1 = /(?:href|src)=["']([^"']+)["']/g;
while ((m = re1.exec(html))) { const u = m[1].trim(); if (/^https?:\/\//i.test(u)) urls.add(u); }
const re2 = /this\.src\s*=\s*['"](https?:\/\/[^'"]+)['"]/g;
while ((m = re2.exec(html))) urls.add(m[1].trim());
const list = [...urls];
console.log(`Внешних ссылок найдено: ${list.length}`);

const vmap = {};
{ const re = /<h3 class="media-title">([\s\S]*?)<\/h3>[\s\S]*?<a[^>]*?href="([^"]+?)"[^>]*?class="media-link"/g; let m2;
  while ((m2 = re.exec(html))) vmap[m2[2]] = m2[1].trim(); }

async function check(u){
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    let res = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA } });
    if (res.status === 405 || res.status === 403)
      res = await fetch(u, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA } });
    clearTimeout(t);
    if (res.ok) return { u, status: res.status, ok: true };
    if (res.status === 429) return { u, status: res.status, ok: true, warn: true };
    return { u, status: res.status, ok: false };
  } catch (e) { clearTimeout(t); return { u, status: 'ERR', ok: false }; }
}
async function mapLimit(items, limit, fn){
  const res = new Array(items.length); let i = 0;
  async function w(){ while (i < items.length){ const idx=i++; res[idx]=await fn(items[idx]); } }
  await Promise.all(Array.from({ length: limit }, w));
  return res;
}

const results = await mapLimit(list, 8, check);

function short(u){ try{ const x=new URL(u); let p=x.pathname+x.search; if(p.length>35)p=p.slice(0,35)+'…'; return x.host.replace(/^www\./,'')+p; }catch{ return u; } }
function isIgnored(u, status){
  const l = u.toLowerCase();
  if (l.includes('fonts.googleapis.com') || l.includes('fonts.gstatic.com') || l.includes('google.com/s2')) return true;
  if (status === 418) return true;
  if (status === 'ERR' && /(вэб\.рф|veb\.ru|sberbank\.ru|rosbank\.ru|дом\.рф|domrf\.ru)/.test(l)) return true;
  return false;
}
function kind(u){
  const l = u.toLowerCase();
  if (l.includes('rutube')||l.includes('vkvideo')||l.includes('youtube')||l.includes('youtu.be')||l.includes('/video')) return 'video';
  if (l.includes('iimage.su')) return 'photo';
  if (/\.(png|jpe?g|svg|webp|gif)(\?|$)/.test(l) || l.includes('favicon')||l.includes('clearbit')||l.includes('logo')||l.includes('wikimedia')||l.includes('wp-content')) return 'logo';
  return 'other';
}

const ignored = results.filter(r => !r.ok && isIgnored(r.u, r.status));
const warned  = results.filter(r => r.ok && r.warn);
const checked = results.filter(r => !isIgnored(r.u, r.status));
const broken  = checked.filter(r => !r.ok);
const okCount = checked.length - broken.length;
const okPercent = checked.length ? Math.round((okCount / checked.length) * 100) : 0;

const avatarUrl = list.find(u => /iimage\.su/.test(u));
const avatarRes = avatarUrl ? results.find(r => r.u === avatarUrl) : null;
const avatarOk = avatarRes && avatarRes.ok;
const avatarLine = !avatarRes ? '❓ не найден' : (avatarOk ? '✅ работает' : `⛔ не открывается (${avatarRes.status})`);

console.log(`OK: ${okCount}  WARN: ${warned.length}  BROKEN: ${broken.length}  IGNORED: ${ignored.length}`);
broken.forEach(b => console.log('BROKEN', b.status, b.u));

if (TG_TOKEN && TG_CHAT) {
  let text;
  const divider = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  
  if (!broken.length) {
    text = `✅ ВСЕ ССЫЛКИ РАБОТАЮТ\n${divider}\n\n` +
           `👤 Аватар: ${avatarLine}\n\n` +
           `📊 Проверено: ${checked.length}\n` +
           `✅ Работает: ${okCount} (100%)\n\n` +
           `🙈 Игнор (системные): ${ignored.length}`;
  } else {
    const cats = [
      ['photo','📷','ФОТО'],
      ['logo','🖼','ЛОГОТИПЫ'],
      ['video','🎬','ВИДЕО'],
      ['other','📄','ПРОЧЕЕ']
    ];
    
    const L = [];
    L.push(`⛔ НАЙДЕНЫ БИТЫЕ ССЫЛКИ`);
    L.push(divider);
    L.push('');
    L.push(`👤 Аватар: ${avatarLine}`);
    L.push('');
    
    for (const [key, emo, name] of cats) {
      const all = checked.filter(r => kind(r.u) === key);
      if (!all.length) continue;
      
      const bad = all.filter(r => !r.ok);
      const good = all.length - bad.length;
      
      L.push(`${emo} ${name}`);
      
      if (!bad.length) {
        L.push(`   ✅ Все OK (${all.length} из ${all.length})`);
      } else {
        L.push(`   ⛔ Проблемы (${bad.length} из ${all.length})`);
        L.push('');
        bad.forEach(b => {
          L.push(`   ⛔ ${b.status}`);
          const t = vmap[b.u];
          if (t) L.push(`      📺 ${t}`);
          L.push(`      🔗 ${short(b.u)}`);
          L.push('');
        });
      }
      L.push('');
    }
    
    L.push(divider);
    L.push(`📊 ИТОГО`);
    L.push(`Проверено: ${checked.length}`);
    L.push(`Работает: ${okCount} (${okPercent}%)`);
    L.push(`Не работает: ${broken.length}`);
    if (ignored.length) L.push(`🙈 Игнор (системные): ${ignored.length}`);
    
    text = L.join('\n');
  }
  
  if (RESUME_URL) text += `\n\n🔗 ${RESUME_URL}`;

  const body = { chat_id: TG_CHAT, text };
  if (RESUME_URL) body.reply_markup = { inline_keyboard: [[{ text: '👀 Открыть резюме', url: RESUME_URL }]] };
  
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    const b2 = await r.json().catch(()=>({}));
    console.log(`Telegram HTTP ${r.status}, ok=${b2.ok}, description=${b2.description||'-'}`);
  } catch(e){ console.log('Telegram ошибка сети:', e?.message); }
} else {
  console.log('TELEGRAM НЕ НАСТРОЕН: задайте секреты TG_BOT_TOKEN и TG_CHAT_ID');
}

process.exit(0);
