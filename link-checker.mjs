import { readFileSync } from 'node:fs';

const HTML_FILE = process.env.HTML_FILE || 'index.html';
const TG_TOKEN  = process.env.TG_BOT_TOKEN || '';
const TG_CHAT   = process.env.TG_CHAT_ID || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Читаем HTML: локальный файл ИЛИ хост-URL
let html;
if (/^https?:\/\//i.test(HTML_FILE)) {
  html = await (await fetch(HTML_FILE, { headers: { 'User-Agent': UA } })).text();
} else {
  html = readFileSync(HTML_FILE, 'utf8');
}

// Собираем все внешние URL: href="...", src="...", и onerror-фолбэки this.src='...'
const urls = new Set();
let m;
const re1 = /(?:href|src)=["']([^"']+)["']/g;
while ((m = re1.exec(html))) { const u = m[1].trim(); if (/^https?:\/\//i.test(u)) urls.add(u); }
const re2 = /this\.src\s*=\s*['"](https?:\/\/[^'"]+)['"]/g;
while ((m = re2.exec(html))) urls.add(m[1].trim());

const list = [...urls];
console.log(`Внешних ссылок найдено: ${list.length}`);

async function check(u) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    let res = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA } });
    if (res.status === 405 || res.status === 403)
      res = await fetch(u, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA } });
    clearTimeout(t);
    if (res.ok) return { u, status: res.status, ok: true };
    if (res.status === 403 || res.status === 429) return { u, status: res.status, ok: true, warn: true };
    return { u, status: res.status, ok: false };
  } catch (e) {
    clearTimeout(t);
    return { u, status: 'ERR:' + (e.cause?.code || e.name || 'ERR'), ok: false };
  }
}

async function mapLimit(items, limit, fn) {
  const res = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; res[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: limit }, worker));
  return res;
}

const results = await mapLimit(list, 8, check);
const broken = results.filter(r => !r.ok);
const warned = results.filter(r => r.ok && r.warn);
const okCount = results.length - broken.length - warned.length;
console.log(`OK: ${okCount}  WARN: ${warned.length}  BROKEN: ${broken.length}`);
broken.forEach(b => console.log('BROKEN', b.status, b.u));
warned.forEach(b => console.log('WARN  ', b.status, b.u));

// Telegram: шлём сводку ВСЕГДА (и когда всё OK, и когда есть битые)
if (TG_TOKEN && TG_CHAT) {
  let text;
  if (broken.length) {
    text = `⛔ Резюме: битые ссылки — ${broken.length}\n` +
           broken.map(b => `• ${b.status} — ${b.u}`).join('\n');
    if (warned.length) text += `\n\n⚠️ Вернули 403/429 (сайт жив, но отклонил запрос): ${warned.length}`;
  } else {
    text = `✅ Ссылки резюме проверены: всё OK\nВсего: ${results.length}, OK: ${okCount}` +
           (warned.length ? `, «warn» (403/429): ${warned.length}` : '') + '.';
  }
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text })
  });
  console.log('Telegram: сообщение отправлено');
} else {
  console.log('Telegram: не настроен (нет TG_BOT_TOKEN / TG_CHAT_ID)');
}

process.exit(broken.length ? 1 : 0);
