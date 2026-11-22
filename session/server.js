// Сервер синхронізації спільного стану 3D-сцени.
// Запуск: node session/server.js
// Підключення: ws://localhost:8091/?name=engineer&profile=lan
import { WebSocketServer, WebSocket } from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORT, T_SN, PROFILES } from '../scene/shared.js';

const poses = new Map();
const marks = [];

let markId = 0;
let sent = 0;

const resultsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../results'
);

// Перевірка координат у межах робочої області сцени.
function validPosition(p) {
  return Array.isArray(p)
    && p.length === 3
    && p.every((v) =>
      typeof v === 'number'
      && Number.isFinite(v)
      && Math.abs(v) < 1100
    );
}

// Перевірка та нормалізація кватерніона орієнтації.
function validOrientation(q) {
  if (
    !Array.isArray(q)
    || q.length !== 4
    || !q.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    return null;
  }

  const norm = Math.hypot(...q);

  if (norm < 1e-6) return null;

  return q.map((v) => v / norm);
}

// Моделювання мережевої затримки.
// Повідомлення доставляються в тому самому порядку, як у TCP.
function link({ rtt, jitter, loss }) {
  let last = 0;

  return (deliver) => {
    let delay = rtt / 2 + Math.random() * jitter;

    // Імітація повторного передавання втраченого сегмента TCP.
    if (Math.random() < loss) {
      delay += rtt;
    }

    last = Math.max(Date.now() + delay, last);

    setTimeout(deliver, Math.max(0, last - Date.now()));
  };
}

const wss = new WebSocketServer({
  port: PORT,
  maxPayload: 16 * 1024
});

function broadcast(message) {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.post(message);
    }
  }
}

function broadcastPresence() {
  const participants = [...wss.clients]
    .filter((client) => client.readyState === WebSocket.OPEN)
    .map((client) => ({
      name: client.name,
      profile: client.profile
    }));

  broadcast({
    type: 'presence',
    participants
  });
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const rawName = url.searchParams.get('name') || 'guest';
  const name = rawName.trim().slice(0, 20);

  const profile = PROFILES[url.searchParams.get('profile')]
    ? url.searchParams.get('profile')
    : 'lan';

  // Не дозволяємо двом підключенням використовувати одне ім'я.
  const duplicate = [...wss.clients].some(
    (client) => client !== ws
      && client.readyState === WebSocket.OPEN
      && client.name === name
  );

  if (!name || duplicate) {
    ws.close(1008, 'Name is empty or already in use');
    return;
  }

  const up = link(PROFILES[profile]);
  const down = link(PROFILES[profile]);

  ws.name = name;
  ws.profile = profile;

  // Відправлення повідомлення конкретному клієнту.
  ws.post = (message) => {
    down(() => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const data = JSON.stringify(message);
      ws.send(data);
      sent += Buffer.byteLength(data);
    });
  };

  // Кожен клієнт отримує поточний список позначок.
  ws.post({
    type: 'marks',
    marks
  });

  console.log(
    `+ ${name} (${profile}), учасників: ${wss.clients.size}`
  );

  broadcastPresence();

  ws.on('message', (raw) => {
    up(() => {
      if (ws.readyState === WebSocket.OPEN) {
        handle(raw.toString());
      }
    });
  });

  ws.on('close', () => {
    poses.delete(name);
    console.log(`- ${name}, учасників: ${wss.clients.size}`);
    broadcastPresence();
  });

  ws.on('error', (error) => {
    console.error(`WebSocket ${name}:`, error.message);
  });

  function handle(raw) {
    let message;

    try {
      message = JSON.parse(raw);
    } catch {
      console.log(`Відкинуто некоректний JSON від ${name}`);
      return;
    }

    if (!message || typeof message !== 'object') return;

    // Поза учасника: клієнт є власником, сервер перевіряє дані.
    if (message.type === 'pose') {
      const q = validOrientation(message.q);

      if (validPosition(message.p) && q) {
        poses.set(name, {
          p: message.p,
          q
        });
      }

      return;
    }

    // Перевірка доступності з'єднання та вимірювання RTT клієнтом.
    if (message.type === 'ping') {
      if (
        typeof message.t === 'number'
        && Number.isFinite(message.t)
      ) {
        ws.post({
          type: 'pong',
          t: message.t
        });
      }

      return;
    }

    // Створення позначки: сервер призначає ID та автора.
    if (message.type === 'mark') {
      const text = typeof message.text === 'string'
        ? message.text.trim()
        : '';

      if (
        validPosition(message.p)
        && text.length > 0
        && text.length <= 80
      ) {
        marks.push({
          id: ++markId,
          author: name,
          text,
          p: message.p
        });

        broadcast({
          type: 'marks',
          marks
        });
      }

      return;
    }

    // Видалити позначку може тільки її автор.
    if (message.type === 'unmark') {
      const index = marks.findIndex(
        (mark) =>
          mark.id === message.id
          && mark.author === name
      );

      if (index >= 0) {
        marks.splice(index, 1);

        broadcast({
          type: 'marks',
          marks
        });
      }

      return;
    }

    // Збереження звіту вимірювань для наступних кроків.
    if (message.type === 'report') {
      const mode = ['interp', 'extrap'].includes(message.mode)
        ? message.mode
        : null;

      if (!mode) return;

      mkdirSync(resultsDir, { recursive: true });

      const file = resolve(
        resultsDir,
        `net-${profile}-${mode}.json`
      );

      writeFileSync(
        file,
        JSON.stringify(message, null, 2)
      );

      console.log(`Звіт ${name}: ${file}`);
    }
  }
});

// Формування знімків кожні 50 мс.
// Кожен клієнт отримує позиції інших учасників, але не власну.
setInterval(() => {
  const t = Date.now();

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    const avatars = Object.fromEntries(
      [...poses].filter(([who]) => who !== client.name)
    );

    client.post({
      type: 'snap',
      t,
      avatars
    });
  }
}, T_SN);

// Облік вихідного мережевого потоку сервера.
setInterval(() => {
  if (wss.clients.size) {
    const rate = (8 * sent / 5000).toFixed(1);

    console.log(
      `учасників ${wss.clients.size}, Rс = ${rate} кбіт/с`
    );
  }

  sent = 0;
}, 5000);

console.log(`Сервер сеансу: ws://localhost:${PORT}`);