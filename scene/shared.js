// Спільні параметри сервера сеансу, бота та клієнта.
export const PORT = 8091;

// Період знімків стану: 50 мс = 20 Гц.
export const T_SN = 50;

// Модельні профілі мережі.
export const PROFILES = {
  lan: {
    rtt: 2,
    jitter: 1,
    loss: 0,
    m: 0
  },
  city: {
    rtt: 20,
    jitter: 5,
    loss: 0.005,
    m: 1
  },
  mobile: {
    rtt: 60,
    jitter: 30,
    loss: 0.02,
    m: 1
  }
};

// Параметри траєкторії тестового учасника.
const R = 6;
const V = 1.5;
const CYCLE = 10;
const STOP = 2;

// Положення бота в момент часу ms.
export function walk(ms) {
  const s = ms / 1000;
  const k = Math.floor(s / CYCLE);
  const u = s - k * CYCLE;

  const path =
    (k * (CYCLE - STOP) + Math.min(u, CYCLE - STOP)) * V;

  const a = (path % (2 * Math.PI * R)) / R;

  return {
    p: [
      R * Math.cos(a),
      1.7,
      R * Math.sin(a)
    ],
    steady: u > 1 && u < CYCLE - STOP
  };
}