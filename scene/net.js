// Багатокористувацький режим (заняття 3): аватари, позначки, вимірювання.
// Адреса: /scene/?name=A&profile=lan|city|mobile[&mode=interp|extrap]
// [&measure=60] — через 60 с звіт про бота надсилається серверу

import * as THREE from 'three';
import { PORT, T_SN, PROFILES, walk } from './shared.js';

export function initNetwork({ scene, camera, renderer, hooks, params }) {

    const name = params.get('name');
    const requestedMode = params.get('mode');

    const mode = ['interp', 'extrap'].includes(requestedMode)
    ? requestedMode
    : 'interp';

    const profile = PROFILES[params.get('profile')]
    ? params.get('profile')
    : 'lan';

    const { m, jitter } = PROFILES[profile];

    const D_INT = (m + 1) * T_SN + jitter;

    const ws = new WebSocket(
    `ws://${location.hostname}:${PORT}/?name=${encodeURIComponent(name)}&profile=${profile}`
    );

    const send = (msg) =>
    ws.readyState === 1 && ws.send(JSON.stringify(msg));

    const snaps = [];
    const offsets = [];
    const avatars = new Map();

    const stat = {
    rtt: [],
    delay: [],
    off: [],
    frames: 0,
    starved: 0
    };

    ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'snap') {
        // буфер знімків за міткою сервера
        snaps.push(msg);

        if (snaps.length > 40) snaps.shift();

        offsets.push(msg.t - Date.now());

        // найменш затриманий знімок
        if (offsets.length > 100) offsets.shift();

    } else if (msg.type === 'pong') {
        stat.rtt.push(Date.now() - msg.t);

    } else if (msg.type === 'marks') {
        showMarks(msg.marks);
    }
    };

    setInterval(() => send({
    type: 'pose',
    p: camera.position.toArray(),
    q: camera.quaternion.toArray()
    }), T_SN);

    setInterval(() => send({
    type: 'ping',
    t: Date.now()
    }), 1000);

    function colorForName(name) {
    let hash = 2166136261;

    for (let i = 0; i < name.length; i++) {
        hash ^= name.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    const hue = (hash >>> 0) / 4294967296;

    return new THREE.Color().setHSL(hue, 0.7, 0.5);
    }

    function avatar(who) {
    // голова й «ніс» — напрям погляду
    if (!avatars.has(who)) {
        const mat = new THREE.MeshStandardMaterial({
            color: colorForName(who)
        });

        const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.35),
        mat
        );

        const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.15, 0.5),
        mat
        );

        nose.rotation.x = -Math.PI / 2;
        nose.position.z = -0.45;

        head.add(nose);
        scene.add(head);

        avatars.set(who, head);
    }

    return avatars.get(who);
    }

    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();

    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();

    function place(who, a, b, k) {
    // інтерполяція (0 ≤ k ≤ 1)
    const obj = avatar(who);
    const A = a.avatars[who];
    const B = b.avatars[who];

    if (!A || !B) return;

    // і екстраполяція (k > 1)
    obj.position.lerpVectors(
        pa.fromArray(A.p),
        pb.fromArray(B.p),
        k
    );

    obj.quaternion.slerpQuaternions(
        qa.fromArray(A.q),
        qb.fromArray(B.q),
        Math.min(k, 1)
    );
    }

    hooks.push(() => {
    // у кожному кадрі
    if (snaps.length < 2) return;

    const now = Date.now();
    const server = now + Math.max(...offsets);

    const t = mode === 'interp'
        ? server - D_INT
        : server;

    let i = snaps.findIndex((s) => s.t > t);

    const starved = i < 0;

    // новіших знімків ще немає
    if (starved) i = snaps.length - 1;

    const a = snaps[Math.max(i - 1, 0)];
    const b = snaps[Math.max(i, 1)];

    let k = Math.max(0, (t - a.t) / (b.t - a.t));

    if (mode === 'interp') {
        k = Math.min(k, 1);
    } else {
        // екстраполяція ≤ 250 мс
        k = Math.min(k, 1 + 250 / (b.t - a.t));
    }

    for (const who of Object.keys(b.avatars)) {
        if (who !== name) {
        place(who, a, b, k);
        }
    }

    for (const [who, obj] of avatars) {
        obj.visible = who in b.avatars;
    }

    if (avatars.has('bot')) {
        measure(now, starved);
    }
    });

    function measure(now, starved) {
    // затримка й відхилення показу бота
    const shown = avatars.get('bot').position;

    let best = 0;
    let min = Infinity;

    // τ, за якого walk(now − τ) ≈ показ
    for (let tau = 0; tau <= 600; tau += 2) {
        const d = shown.distanceTo(
        pb.fromArray(walk(now - tau).p)
        );

        if (d < min) [min, best] = [d, tau];
    }

    stat.frames++;
    stat.starved += starved;

    stat.off.push(min);

    // відхилення від траєкторії, м
    if (walk(now).steady) {
        stat.delay.push(best);
    }
    }

    const group = new THREE.Group();

    scene.add(group);

    // позначки на сцені й у HUD
    document.getElementById('hud').insertAdjacentHTML(
    'beforeend',
    `<div>${name} · ${profile} · ${mode}</div><ul id="marks"></ul>`
    );


    function createPinLabel(number) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;

        const ctx = canvas.getContext('2d');

        ctx.beginPath();
        ctx.arc(64, 64, 56, 0, Math.PI * 2);
        ctx.fillStyle = '#d32f2f';
        ctx.fill();

        ctx.lineWidth = 7;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 64px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), 64, 66);

        const texture = new THREE.CanvasTexture(canvas);

        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthTest: false
            })
        );

        sprite.scale.set(0.45, 0.45, 1);
        sprite.renderOrder = 10;

        return sprite;
    }

    function showMarks(list) {
        // Очищення попередніх позначок і ресурсів
        for (const child of group.children) {
            child.geometry?.dispose();

            if (child.material) {
                child.material.map?.dispose();
                child.material.dispose();
            }
        }

        group.clear();

        const items = list.map((mk, index) => {
            const number = index + 1;

            const pin = new THREE.Mesh(
                new THREE.ConeGeometry(0.15, 0.6),
                new THREE.MeshBasicMaterial({ color: 0xd32f2f })
            );

            pin.rotation.x = Math.PI;
            pin.position.fromArray(mk.p);
            pin.position.y += 0.3;

            group.add(pin);

            // Номер над конусом
            const label = createPinLabel(number);

            label.position.fromArray(mk.p);
            label.position.y += 0.8;

            group.add(label);

            const safeAuthor = String(mk.author)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');

            const safeText = String(mk.text)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');

            return `<li><strong>${number}.</strong> ${safeAuthor}: ${safeText}` +
                (mk.author === name
                    ? ` <a href="#" data-id="${mk.id}">×</a>`
                    : '') +
                '</li>';
        });

        document.getElementById('marks').innerHTML = items.join('');
    }

    document.getElementById('marks').onclick = (e) => {
        if (e.target.dataset.id) {
            e.preventDefault();

            send({
                type: 'unmark',
                id: +e.target.dataset.id
            });
        }
    };


    const ray = new THREE.Raycaster();

    // подвійне клацання — позначка
    renderer.domElement.addEventListener('dblclick', (e) => {
    const r = renderer.domElement.getBoundingClientRect();

    ray.setFromCamera(
        new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
        ),
        camera
    );

    const hit = ray.intersectObjects(scene.children, true)[0];

    const text = hit && prompt('Текст позначки', 'Перевірити');

    if (text) {
        send({
        type: 'mark',
        text,
        p: hit.point.toArray()
        });
    }
    });

    const pct = (a, p) => {
    const s = [...a].sort((x, y) => x - y);

    return s.length
        ? +s[Math.floor(p * (s.length - 1))].toFixed(3)
        : null;
    };

    const seconds = Number(params.get('measure'));

    if (seconds) {
    setTimeout(() => {
        // звіт: results/net-<профіль>-<режим>
        const report = {
        type: 'report',
        profile,
        mode,

        d_int_ms: mode === 'interp' ? D_INT : 0,

        rtt_p50_ms: pct(stat.rtt, 0.5),
        delay_p50_ms: pct(stat.delay, 0.5),
        delay_p95_ms: pct(stat.delay, 0.95),

        off_max_m: pct(stat.off, 1),

        starved_pct: stat.frames
            ? +((100 * stat.starved) / stat.frames).toFixed(1)
            : null,

        frames: stat.frames
        };

        send(report);

        document.getElementById('marks').textContent =
        JSON.stringify(report);

    }, seconds * 1000);
    }
}