// Бот-учасник для перевірки багатокористувацького режиму.
// Рухається за відомою траєкторією walk() і надсилає позу кожні 49 мс.

import WebSocket from 'ws';
import { PORT, walk } from '../scene/shared.js';

const ws = new WebSocket(
  `ws://localhost:${PORT}/?name=bot&profile=lan`
);

ws.on('open', () => {
  console.log('Бот у сеансі. Ctrl+C — зупинка');

  setInterval(() => {
    ws.send(JSON.stringify({
      type: 'pose',
      p: walk(Date.now()).p,
      q: [0, 0, 0, 1]
    }));
  }, 49);
});

ws.on('error', (e) => {
  console.error('Немає сервера сеансу:', e.message);
});