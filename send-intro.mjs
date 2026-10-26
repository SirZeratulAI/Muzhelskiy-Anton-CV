const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const CHAT_ID = process.env.TG_CHAT_ID;

// Ссылки для кнопок
const INTERACTIVE_URL = 'https://SirZeratulAI.github.io/Muzhelskiy-Anton-CV/';
const PDF_URL = 'https://SirZeratulAI.github.io/Muzhelskiy-Anton-CV/CV_Мужельcкий-Антон_dark_2026.pdf';
const TELEGRAM_URL = 'https://t.me/AntonMuzhelskiy';

// Текст сообщения (обрати внимание на переносы строк через \n)
const text = `Добрый день!
Направляю резюме для рассмотрения на руководящие позиции в цифровой трансформации / CPO / CDTO / ЗГД по цифровой трансформации

Подробнее о моем опыте вы можете ознакомиться в интерактивном или классическом PDF резюме

С уважением,
Антон Мужельский`;

// Настройка кнопок
const keyboard = {
  inline_keyboard: [
    [{ text: '🌐 Интерактивное CV', url: INTERACTIVE_URL }],
    [{ text: ' Классическое PDF CV', url: PDF_URL }],
    [{ text: '💬 Связаться со мной', url: TELEGRAM_URL }]
  ]
};

// Отправка сообщения
const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: CHAT_ID,
    text: text,
    reply_markup: keyboard,
    parse_mode: 'HTML'
  })
});

const result = await response.json();
console.log('Telegram API Response:', JSON.stringify(result, null, 2));

if (!result.ok) {
  throw new Error(`Failed to send message: ${result.description}`);
}
