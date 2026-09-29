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

// Собираем все URL
const urls = new Set(); let m;
const re1 = /(?:href|src)=["']([^"']+)["']/g;
while ((m = re1.exec(html))) { const u = m[1].trim(); if (/^https?:\/\//i.test(u)) urls.add(u); }
const re2 = /this\.src\s*=\s*['"](https?:\/\/[^'"]+)['"]/g;
while ((m = re2.exec(html))) urls.add(m[1].trim());
const list = [...urls];

// Извлекаем текст для бота из скрытого блока
const botTextMatch = html.match(/<div\s+class="bot-message-text"[^>]*>([\s\S]*?)<\/div>/);
const botMessageText = botTextMatch ? botTextMatch[1].replace(/<[^>]+>/g, '').trim() : '';

// Карта: URL видео/статьи -> его название
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

// Игнорируемые ссылки (системные, анти-бот)
function isIgnored(u, status){
  const l = u.toLowerCase();
  if (l.includes('fonts.googleapis.com') || l.includes('fonts.gstatic.com') || l.includes('google.com/s2')) return true;
  if (status === 418) return true;
  if (status === 'ERR' && /(вэб\.рф|veb\.ru|sberbank\.ru|rosbank\.ru|дом\.рф|domrf\.ru)/.test(l)) return true;
  return false;
}

// Классификация ссылок
function kind(u){
  const l = u.toLowerCase();
  if (l.includes('rutube')||l.includes('vkvideo')||l.includes('youtube')||l.includes('youtu.be')||l.includes('/video')) return 'video';
  if (l.includes('iimage.su')) return 'photo';
  if (/\.(png|jpe?g|svg|webp|gif)(\?|$)/.test(l) || l.includes('favicon')||l.includes('clearbit')||l.includes('logo')||l.includes('wikimedia')||l.includes('wp-content')) return 'logo';
  return 'other';
}

// Разделяем: аватар/логотипы vs остальные ссылки
const avatarUrl = list.find(u => /iimage\.su/.test(u));
const avatarRes = avatarUrl ? results.find(r => r.u === avatarUrl) : null;
const avatarOk = avatarRes && avatarRes.ok;

const logoUrls = list.filter(u => kind(u) === 'logo');
const logoResults = logoUrls.map(u => results.find(r => r.u === u)).filter(Boolean);
const logosOk = logoResults.filter(r => r.ok).length;
const logosBroken = logoResults.filter(r => !r.ok && !isIgnored(r.u, r.status));

const otherUrls = list.filter(u => kind(u) !== 'logo' && u !== avatarUrl);
const otherResults = otherUrls.map(u => results.find(r => r.u === u)).filter(Boolean);
const otherOk = otherResults.filter(r => r.ok || isIgnored(r.u, r.status)).length;
const otherBroken = otherResults.filter(r => !r.ok && !isIgnored(r.u, r.status));

const totalChecked = logoResults.length + otherResults.length;
const totalBroken = logosBroken.length + otherBroken.length;

console.log(`Всего ссылок: ${list.length}`);
console.log(`Аватар: ${avatarOk ? '✅' : ''}`);
console.log(`Логотипы: ${logosOk} OK, ${logosBroken.length} битых`);
console.log(`Остальные: ${otherOk} OK, ${otherBroken.length} битых`);

// Формируем сообщение
if (TG_TOKEN && TG_CHAT) {
  const divider = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  
  // Сообщение 1: Статус ссылок
  let msg1 = `🔍 ПРОВЕРКА ССЫЛОК\n${divider}\n\n`;
  
  // Аватар
  msg1 += `👤 Аватар: ${avatarOk ? '✅ работает' : '⛔ не открывается'}\n\n`;
  
  // Логотипы компаний
  msg1 += `🖼 Логотипы компаний:\n`;
  if (logosBroken.length === 0) {
    msg1 += `   ✅ Все OK (${logosResults.length})\n`;
  } else {
    msg1 += `   ⛔ Битых: ${logosBroken.length} из ${logoResults.length}\n`;
    logosBroken.forEach(b => {
      msg1 += `      ⛔ ${b.status} — ${short(b.u)}\n`;
    });
  }
  msg1 += `\n`;
  
  // Видео, статьи, прочие ссылки
  msg1 += `🎬 Видео, статьи, ссылки:\n`;
  if (otherBroken.length === 0) {
    msg1 += `   ✅ Все OK (${otherResults.length})\n`;
  } else {
    msg1 += `   ⛔ Битых: ${otherBroken.length} из ${otherResults.length}\n`;
    otherBroken.forEach(b => {
      const name = vmap[b.u];
      msg1 += `      ⛔ ${b.status}\n`;
      if (name) msg1 += `         📺 ${name}\n`;
      msg1 += `          ${short(b.u)}\n`;
    });
  }
  
  msg1 += `\n${divider}\n`;
  msg1 += ` ИТОГО: проверено ${totalChecked}, OK ${totalChecked - totalBroken}, битых ${totalBroken}`;
  
  if (RESUME_URL) msg1 += `\n\n🔗 ${RESUME_URL}`;
  
  const body1 = { chat_id: TG_CHAT, text: msg1 };
  if (RESUME_URL) body1.reply_markup = { inline_keyboard: [[{ text: '👀 Открыть резюме', url: RESUME_URL }]] };
  
  try {
    const r1 = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body1)
    });
    const b1 = await r1.json().catch(()=>({}));
    console.log(`Telegram msg1: HTTP ${r1.status}, ok=${b1.ok}`);
  } catch(e){ console.log('Telegram msg1 ошибка:', e?.message); }
  
  // Сообщение 2: Текст для бота + превью
  if (botMessageText) {
    const msg2 = `${botMessageText}\n\n🔗 ${RESUME_URL || 'Ссылка на резюме не настроена'}`;
    const body2 = { chat_id: TG_CHAT, text: msg2 };
    if (RESUME_URL) body2.reply_markup = { inline_keyboard: [[{ text: '👀 Открыть резюме', url: RESUME_URL }]] };
    
    try {
      const r2 = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body2)
      });
      const b2 = await r2.json().catch(()=>({}));
      console.log(`Telegram msg2: HTTP ${r2.status}, ok=${b2.ok}`);
    } catch(e){ console.log('Telegram msg2 ошибка:', e?.message); }
  } else {
    console.log('Текст для бота не найден в HTML');
  }
} else {
  console.log('TELEGRAM НЕ НАСТРОЕН');
}

process.exit(0);
