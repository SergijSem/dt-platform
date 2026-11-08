"""Перевірка узгодженості стану цифрового двійника з джерелом даних.

Запуск з кореня репозиторію:
python sync/consistency.py

Порівнює результати емулятора (results/source.csv),
історію станів у InfluxDB та поточний стан у Ditto.
"""

import csv
import math
import statistics

import requests
from influxdb_client import InfluxDBClient


THING = "org.pzks:scooter-1"
API = f"http://localhost:8090/api/2/things/{THING}"

INFLUX = {
    "url": "http://localhost:8086",
    "token": "dt-lab-token",
    "org": "pzks"
}

BUCKET = "twin"
TARGET_MS = 250

# Поле CSV → (функціональний блок, властивість, поле InfluxDB)
FIELDS = {
    "v": ("runningGear", "speed", "speed"),
    "rpm": ("motor", "rpm", "rpm"),
    "i": ("battery", "current", "current"),
    "u": ("battery", "voltage", "voltage"),
    "temp": ("motor", "temperature", "temperature"),
    "soc": ("battery", "stateOfCharge", "stateOfCharge"),
    "brk": ("brakes", "active", "brakes_active"),
    "lck": ("security", "locked", "security_locked")
}


def source():
    """Зчитування вихідної телеметрії: {seq: рядок CSV}."""

    with open(
        "results/source.csv",
        newline="",
        encoding="utf-8"
    ) as f:
        rows = csv.DictReader(f, delimiter=";")
        result = {
            int(row["seq"]): row
            for row in rows
        }

    if not result:
        raise RuntimeError("results/source.csv не містить повідомлень")

    return result


def history(start_ms, stop_ms):
    """Отримання історії InfluxDB: {seq: запис}."""

    start = start_ms * 1_000_000
    stop = (stop_ms + 1) * 1_000_000

    query = f'''
from(bucket: "{BUCKET}")
  |> range(start: time(v: {start}), stop: time(v: {stop}))
  |> filter(fn: (r) => r._measurement == "twin_state")
  |> filter(fn: (r) => r.thing == "{THING}")
  |> pivot(
      rowKey: ["_time"],
      columnKey: ["_field"],
      valueColumn: "_value"
  )
'''

    with InfluxDBClient(**INFLUX) as client:
        tables = client.query_api().query(query)

    result = {}

    for table in tables:
        for record in table.records:
            values = record.values

            if values.get("seq") is not None:
                result[int(values["seq"])] = values

    return result


def parse_bool(value):
    """Перетворення текстового значення CSV на bool."""

    return str(value).strip().lower() in ("true", "1")


def values_match(source_row, history_row):
    """Перевірка збігу всіх телеметричних властивостей."""

    for csv_field, (_, _, influx_field) in FIELDS.items():
        expected = source_row[csv_field]
        actual = history_row.get(influx_field)

        if actual is None:
            return False

        if csv_field in ("brk", "lck"):
            if parse_bool(expected) != bool(actual):
                return False
        else:
            if abs(float(expected) - float(actual)) > 1e-9:
                return False

    return True


def main():
    src = source()

    stamps = [int(row["ts"]) for row in src.values()]
    hist = history(min(stamps), max(stamps))

    # Повідомлення, яких немає в історії.
    missing = sorted(set(src) - set(hist))

    # Повідомлення, значення яких відрізняються від джерела.
    common = set(src) & set(hist)
    wrong = sorted(
        seq for seq in common
        if not values_match(src[seq], hist[seq])
    )

    # Перевірка порядку застосування за ревізіями Ditto.
    order = sorted(
        hist.values(),
        key=lambda row: int(row.get("revision", 0))
    )

    reordered = sum(
        1
        for a, b in zip(order, order[1:])
        if int(b["seq"]) < int(a["seq"])
    )

    # Перевірка пропущених ревізій.
    revisions = [
        int(row["revision"])
        for row in order
        if row.get("revision") is not None
    ]

    gaps = (
        max(revisions) - min(revisions) + 1 - len(set(revisions))
        if revisions else 0
    )

    # Перевірка поточного стану цифрового двійника.
    response = requests.get(API, timeout=10)
    response.raise_for_status()
    twin = response.json()["features"]

    last = src[max(src)]
    final_ok = True

    for csv_field, (feature, prop, _) in FIELDS.items():
        actual = twin.get(feature, {}).get("properties", {}).get(prop)

        if actual is None:
            final_ok = False
            break

        if csv_field in ("brk", "lck"):
            if parse_bool(last[csv_field]) != bool(actual):
                final_ok = False
                break
        elif abs(float(last[csv_field]) - float(actual)) > 1e-9:
            final_ok = False
            break

    # Аналіз затримки синхронізації.
    delays = sorted(
        float(row["sync_ms"])
        for row in hist.values()
        if row.get("sync_ms") is not None
    )

    latency = "немає даних"

    if delays:
        p50 = statistics.median(delays)
        p95 = delays[math.ceil(0.95 * len(delays)) - 1]

        verdict = (
            "виконано"
            if p95 <= TARGET_MS
            else "НЕ виконано"
        )

        latency = (
            f"{p50:.0f} / {p95:.0f} "
            f"(ціль ≤ {TARGET_MS}: {verdict})"
        )

    # Формування звіту.
    history_percent = len(hist) / len(src) * 100

    report = "\n".join([
        "| Перевірка | Результат |",
        "|---|---|",
        f"| Надіслано джерелом | {len(src)} |",
        f"| Є в історії двійника | {len(hist)} ({history_percent:.1f}%) |",
        f"| Втрачено (номери) | {len(missing)} {missing[:10]} |",
        f"| Розбіжність значень | {len(wrong)} {wrong[:10]} |",
        f"| Позачергові оновлення | {reordered} |",
        f"| Пропущені ревізії | {gaps} |",
        f"| Кінцевий стан = останній відлік | {'так' if final_ok else 'НІ'} |",
        f"| Затримка синхронізації p50 / p95, мс | {latency} |"
    ])

    print(report)

    with open(
        "results/consistency.md",
        "w",
        encoding="utf-8"
    ) as f:
        f.write(report + "\n")

    print("\nЗвіт збережено у results/consistency.md")


if __name__ == "__main__":
    main()