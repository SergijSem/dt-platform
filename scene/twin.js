import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

export async function bindTwin(station) {
  const response = await fetch('binding.json');
  if (!response.ok) {
    throw new Error('Не вдалося завантажити binding.json');
  }

  const cfg = await response.json();
  const color = new THREE.Color();
  const rows = new Map();
  const painted = new Set();

  $('thing').textContent = cfg.thing;

  for (const b of cfg.bindings) {
    const id = `${b.feature}-${b.property}`;
    const row = document.createElement('tr');

    const title = document.createElement('td');
    title.textContent = b.title;

    const value = document.createElement('td');
    value.textContent = '—';

    const unit = document.createElement('td');
    unit.textContent = b.unit;

    row.append(title, value, unit);
    $('vals').append(row);
    rows.set(id, value);
  }

  function apply(thing) {
    const features = thing.features ?? {};
    painted.clear();

    for (const b of cfg.bindings) {
      const id = `${b.feature}-${b.property}`;
      const value = features[b.feature]?.properties?.[b.property];

      if (b.type === 'boolean') {
        if (typeof value !== 'boolean') continue;

        if (b.property === 'active') {
          rows.get(id).textContent =
            value ? 'Активні' : 'Не активні';
        } else if (b.property === 'locked') {
          rows.get(id).textContent =
            value ? 'Заблоковано' : 'Розблоковано';
        } else {
          rows.get(id).textContent = value ? 'Так' : 'Ні';
        }

        continue;
      }

      if (typeof value !== 'number') continue;

      rows.get(id).textContent = value.toFixed(2);

      if (b.color) {
        const x = THREE.MathUtils.clamp(
          (value - b.min) / (b.max - b.min), 0, 1
        );

        color.setHSL(0.33 * (1 - x), 0.8, 0.45);

        if (station.paint(b.node, color)) {
          painted.add(b.node);
        }
      }
    }

    $('bound').textContent = `${painted.size} з 3 компонентів`;

    if (thing._revision !== undefined) {
      $('rev').textContent = thing._revision;
    }

    if (features.sync?.properties?.ts !== undefined) {
      sourceTs = features.sync.properties.ts;
    }
  }

  let sourceTs = 0;
  const api = '/api/2/things';

  try {
    const initial = await fetch(
      `${api}/${encodeURIComponent(cfg.thing)}?fields=features,_revision`
    );

    if (!initial.ok) {
      throw new Error(`Ditto API: HTTP ${initial.status}`);
    }

    apply(await initial.json());
  } catch (error) {
    console.error(error);
    $('bound').textContent = 'помилка API';
  }

  const events = new EventSource(
    `${api}?ids=${encodeURIComponent(cfg.thing)}&fields=features,_revision`
  );

  events.onmessage = (event) => {
    if (!event.data) return;

    try {
      apply(JSON.parse(event.data));
    } catch (error) {
      console.error('Помилка обробки SSE:', error);
    }
  };

  events.onerror = (error) => {
    console.warn('Помилка SSE-з’єднання:', error);
  };

  setInterval(() => {
    if (!sourceTs) return;

    const age = (Date.now() - sourceTs) / 1000;
    $('age').textContent = `${age.toFixed(1)} с`;
    $('age').className = age < 2 ? '' : 'stale';
  }, 250);
}
