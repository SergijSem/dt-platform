function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(p * sorted.length) - 1
  );
  return Number(sorted[index].toFixed(2));
}

function summary(values) {
  return {
    p50: percentile(values, 0.50),
    p99: percentile(values, 0.99),
    min: values.length ? Number(Math.min(...values).toFixed(2)) : null,
    max: values.length ? Number(Math.max(...values).toFixed(2)) : null
  };
}

function estimateTextureMemory(scene) {
  const seen = new Set();
  let bytes = 0;

  scene.traverse((object) => {
    if (!object.material) return;

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (!value?.isTexture || seen.has(value)) continue;

        seen.add(value);

        const image = value.image ?? value.source?.data;
        const width = image?.width ?? image?.videoWidth ?? 0;
        const height = image?.height ?? image?.videoHeight ?? 0;

        if (width && height) {
          // RGBA8 + приблизно 1/3 на mip-рівні.
          bytes += width * height * 4 * (value.generateMipmaps ? 4 / 3 : 1);
        }
      }
    }
  });

  return {
    count: seen.size,
    bytes,
    mb: Number((bytes / 1024 / 1024).toFixed(2))
  };
}

export function createBench({
  renderer,
  camera,
  controls,
  scene,
  duration = 30
}) {
  const gl = renderer.getContext();
  const gpuExtension = gl.getExtension('EXT_disjoint_timer_query_webgl2');

  const warmupMs = 3000;
  const durationMs = duration * 1000;
  const target = controls.target.clone();

  const frameIntervals = [];
  const cpuTimes = [];
  const gpuTimes = [];
  const gpuSamples = [];
  const calls = [];
  const triangles = [];
  const pendingQueries = [];

  const startedAt = performance.now();
  let previousFrame = null;
  let measurementStarted = null;
  let firstFrameData = null;
  let finished = false;
  let activeQuery = null;

  const panel = document.createElement('section');
  Object.assign(panel.style, {
    position: 'fixed',
    zIndex: '10000',
    top: '12px',
    left: '12px',
    maxWidth: '440px',
    padding: '12px',
    color: '#fff',
    background: 'rgba(0,0,0,.88)',
    borderRadius: '8px',
    font: '13px/1.5 monospace',
    whiteSpace: 'pre-wrap'
  });

  const output = document.createElement('div');
  output.textContent = 'Профілювання: прогрів 3 с...';

  const saveButton = document.createElement('button');
  saveButton.textContent = 'Зберегти perf-before.json';
  saveButton.disabled = true;
  saveButton.style.marginTop = '8px';

  panel.append(output, saveButton);
  document.body.append(panel);

  let result = null;

  saveButton.addEventListener('click', () => {
    if (!result) return;

    const blob = new Blob(
      [JSON.stringify(result, null, 2)],
      { type: 'application/json' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `perf-${new URLSearchParams(location.search).get('label') || 'before'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  // Фіксована роздільна здатність рендерингу.
  renderer.setPixelRatio(1);
  renderer.setSize(1920, 1080, false);
  camera.aspect = 1920 / 1080;
  camera.updateProjectionMatrix();
  renderer.domElement.style.width = '100vw';
  renderer.domElement.style.height = '100vh';

  controls.enabled = false;

  function pollGpuQueries() {
    if (!gpuExtension) return;

    for (let i = pendingQueries.length - 1; i >= 0; i--) {
      const item = pendingQueries[i];
      const query = item.query;

      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        continue;
      }

      const disjoint = gl.getParameter(gpuExtension.GPU_DISJOINT_EXT);

        if (!disjoint) {
        const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
        const gpuMs = ns / 1e6;

        gpuTimes.push(gpuMs);
        gpuSamples.push({ cpu: item.cpu, gpu: gpuMs });
        }

      gl.deleteQuery(query);
      pendingQueries.splice(i, 1);
    }
  }

  function finish() {
    if (finished) return;
    finished = true;

    const info = renderer.info.render;
    const textureMemory = estimateTextureMemory(scene);

    result = {
      label: new URLSearchParams(location.search).get('label') || 'before',
      device: navigator.userAgent,
      resolution: '1920x1080',
      cpuThrottling: '6x (налаштовується в DevTools)',
      warmupSeconds: 3,
      durationSeconds: duration,
      gpuTimerSupported: Boolean(gpuExtension),

      frames: frameIntervals.length,
      frameIntervalMs: summary(frameIntervals),
      cpuMs: summary(cpuTimes),
      gpuMs: gpuExtension ? summary(gpuTimes) : null,

        in_budget_pct: Number((
        100 * (
            gpuExtension
            ? gpuSamples.filter(
                sample => Math.max(sample.cpu, sample.gpu) <= 16.7
                ).length / Math.max(gpuSamples.length, 1)
            : cpuTimes.filter(cpu => cpu <= 16.7).length /
                Math.max(cpuTimes.length, 1)
        )
        ).toFixed(2)),

      calls: summary(calls),
      triangles: summary(triangles),

      textures: textureMemory,
      data_first_frame: firstFrameData,

      notes: gpuExtension
        ? 'GPU-час отримано через EXT_disjoint_timer_query_webgl2.'
        : 'GPU-таймер недоступний; GPU-час не вимірювався.'
    };

    output.textContent =
      `Профілювання завершено\n` +
      `Кадрів: ${result.frames}\n` +
      `CPU p50 / p99: ${result.cpuMs.p50} / ${result.cpuMs.p99} мс\n` +
      `GPU p50 / p99: ${result.gpuMs?.p50 ?? 'недоступно'} / ${result.gpuMs?.p99 ?? 'недоступно'} мс\n` +
      `Кадрів у бюджеті: ${result.in_budget_pct}%\n` +
      `Виклики, максимум: ${result.calls.max}\n` +
      `Трикутники, максимум: ${result.triangles.max}\n` +
      `Текстури: ${textureMemory.mb} МБ\n` +
      `Дані до першого кадру: ${firstFrameData?.mb ?? '—'} МБ`;

    saveButton.disabled = false;
    console.log('BENCH RESULT', result);
  }

  function beforeFrame(now) {
    if (finished) return;

    const elapsed = now - startedAt;

    if (elapsed < warmupMs) {
      output.textContent =
        `Профілювання: прогрів ${Math.ceil((warmupMs - elapsed) / 1000)} с...`;
      return;
    }

    if (measurementStarted === null) {
      measurementStarted = now;
      firstFrameData = (() => {
        const entries = performance.getEntriesByType('resource');
        const bytes = entries.reduce(
          (sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0),
          0
        );

        return {
          requests: entries.length,
          bytes,
          mb: Number((bytes / 1024 / 1024).toFixed(2))
        };
      })();

      previousFrame = now;
    }

    const testElapsed = now - measurementStarted;

    if (testElapsed >= durationMs) {
      finish();
      return;
    }

    // Однаковий обліт: 8–308 м, повне коло за час тесту.
    const progress = testElapsed / durationMs;
    const distance = 8 + 300 * progress;
    const angle = progress * Math.PI * 2;

    camera.position.set(
      target.x + Math.cos(angle) * distance,
      target.y + Math.max(2, distance * 0.35),
      target.z + Math.sin(angle) * distance
    );

    camera.lookAt(target);
    camera.updateMatrixWorld();

    if (previousFrame !== null) {
      frameIntervals.push(now - previousFrame);
    }

    previousFrame = now;
  }

  function beginRender() {
    if (
      finished ||
      measurementStarted === null ||
      !gpuExtension ||
      pendingQueries.length >= 8
    ) {
      activeQuery = null;
      return;
    }

    activeQuery = gl.createQuery();
    gl.beginQuery(gpuExtension.TIME_ELAPSED_EXT, activeQuery);
  }

  function endRender(cpuMs) {
    if (finished || measurementStarted === null) return;

    if (activeQuery) {
      gl.endQuery(gpuExtension.TIME_ELAPSED_EXT);
      pendingQueries.push({ query: activeQuery, cpu: cpuMs });
      activeQuery = null;
    }

    cpuTimes.push(cpuMs);
    calls.push(renderer.info.render.calls);
    triangles.push(renderer.info.render.triangles);

    pollGpuQueries();

    const elapsed = performance.now() - measurementStarted;
    output.textContent =
      `Профілювання: ${(elapsed / 1000).toFixed(1)} / ${duration} с\n` +
      `Кадрів: ${cpuTimes.length}`;
  }

  return {
    beforeFrame,
    beginRender,
    endRender
  };
}