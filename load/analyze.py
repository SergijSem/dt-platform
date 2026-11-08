"""Аналіз навантажувального тестування: затримка й втрати за ступенями.

Запуск з кореня репозиторію після завершення Locust:
python load/analyze.py

Вхід:
- results/sent.csv — надіслані повідомлення;
- історія станів у InfluxDB — отримані повідомлення.

Вихід:
- results/load.csv;
- results/latency_vs_load.png.
"""

import csv
import math
import statistics
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from influxdb_client import InfluxDBClient


INFLUX = {
    "url": "http://localhost:8086",
    "token": "dt-lab-token",
    "org": "pzks"
}

TARGET_MS = 250  # NFR-01, мс


def quantile(values, q):
    """Обчислення процентиля методом найближчого рангу."""

    values = sorted(values)
    return values[max(0, math.ceil(q * len(values)) - 1)]


# Читання повідомлень, надісланих Locust.
with open("results/sent.csv", newline="", encoding="utf-8") as f:
    sent = {
        int(r["seq"]): (int(r["ts"]), int(r["rate"]))
        for r in csv.DictReader(f)
    }

if not sent:
    raise RuntimeError("results/sent.csv не містить повідомлень")

stamps = [ts for ts, _ in sent.values()]

start = min(stamps) * 1_000_000
stop = (max(stamps) + 1) * 1_000_000

# Отримання історії станів із InfluxDB.
query = f'''
from(bucket: "twin")
  |> range(start: time(v: {start}), stop: time(v: {stop}))
  |> filter(fn: (r) => r._measurement == "twin_state")
  |> filter(fn: (r) => r.thing == "org.pzks:scooter-1")
  |> filter(fn: (r) =>
      r._field == "seq" or
      r._field == "sync_ms" or
      r._field == "revision"
  )
  |> pivot(
      rowKey: ["_time"],
      columnKey: ["_field"],
      valueColumn: "_value"
  )
'''

with InfluxDBClient(**INFLUX) as client:
    records = [
        r.values
        for table in client.query_api().query(query)
        for r in table.records
    ]

# Зіставлення надісланих і отриманих повідомлень.
received = {
    int(r["seq"]): r["sync_ms"]
    for r in records
    if r.get("seq") is not None and r.get("sync_ms") is not None
}

# Аналіз пропущених ревізій.
revs = sorted(
    int(r["revision"])
    for r in records
    if r.get("revision") is not None
)

gaps = (
    revs[-1] - revs[0] + 1 - len(set(revs))
    if revs else 0
)

# Групування результатів за рівнями навантаження.
steps = defaultdict(
    lambda: {"sent": 0, "delays": [], "ts": []}
)

for seq, (ts, rate) in sent.items():
    steps[rate]["sent"] += 1
    steps[rate]["ts"].append(ts)

    if seq in received:
        steps[rate]["delays"].append(received[seq])

# Формування підсумкової таблиці.
rows = []

for rate in sorted(steps):
    s = steps[rate]
    d = s["delays"]

    span = (max(s["ts"]) - min(s["ts"])) / 1000 or 1

    rows.append({
        "rate": rate,
        "actual_rate": round(s["sent"] / span),
        "sent": s["sent"],
        "received": len(d),
        "loss_pct": round(
            100 * (1 - len(d) / s["sent"]), 2
        ),
        "p50_ms": round(statistics.median(d)) if d else None,
        "p95_ms": round(quantile(d, 0.95)) if d else None
    })

if not rows:
    raise RuntimeError("Не вдалося сформувати результати аналізу")

# Збереження CSV.
with open(
    "results/load.csv",
    "w",
    newline="",
    encoding="utf-8"
) as f:
    writer = csv.DictWriter(
        f,
        fieldnames=list(rows[0])
    )
    writer.writeheader()
    writer.writerows(rows)

for row in rows:
    print(row)

print(
    f"Пропущено ревізій: {gaps} "
    "(застосовані платформою, але не отримані істориком)"
)

# Побудова графіка залежності затримки від навантаження.
ok = [
    r for r in rows
    if r["p95_ms"] is not None and r["p50_ms"] is not None
    and r["p50_ms"] > 0 and r["p95_ms"] > 0
]

if not ok:
    raise RuntimeError("Недостатньо даних для побудови графіка")

x = [r["actual_rate"] for r in ok]

fig, ax = plt.subplots(figsize=(7, 4))

ax.plot(
    x,
    [r["p50_ms"] for r in ok],
    "o-",
    label="Медіана"
)

ax.plot(
    x,
    [r["p95_ms"] for r in ok],
    "s-",
    label="95-й процентиль"
)

ax.axhline(
    TARGET_MS,
    color="red",
    linestyle="--",
    label=f"Ціль NFR-01, {TARGET_MS} мс"
)

ax.set_xscale("log")
ax.set_yscale("log")
ax.set_xlabel("Фактична частота телеметрії, повідомлень/с")
ax.set_ylabel("Затримка синхронізації, мс")
ax.grid(True, which="both", alpha=0.3)
ax.legend()

fig.tight_layout()
fig.savefig("results/latency_vs_load.png", dpi=150)

print("Графік: results/latency_vs_load.png")
print("Таблиця: results/load.csv")