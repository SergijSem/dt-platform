"""Історія станів цифрового двійника:
події SSE платформи Ditto → InfluxDB.

Запуск з кореня репозиторію:
python sync/historian.py
"""

import json
import time

import requests
from influxdb_client import InfluxDBClient, Point, WriteOptions


SSE_URL = "http://localhost:8090/api/2/things"
THING = "org.pzks:scooter-1"

INFLUX = {
    "url": "http://localhost:8086",
    "token": "dt-lab-token",
    "org": "pzks"
}

BUCKET = "twin"


def events():
    """Отримання подій SSE та часу їх надходження."""

    params = {
        "ids": THING,
        "fields": "thingId,features,_revision"
    }
    headers = {"Accept": "text/event-stream"}

    with requests.get(
        SSE_URL,
        params=params,
        headers=headers,
        stream=True,
        timeout=(5, None)
    ) as response:

        response.raise_for_status()
        response.encoding = "utf-8"

        print(
            f"Підключено до потоку змін {THING}. Ctrl+C — зупинка",
            flush=True
        )

        for line in response.iter_lines(
            chunk_size=None,
            decode_unicode=True
        ):
            if line and line.startswith("data:") and len(line) > 5:
                received_ms = time.time() * 1000
                yield json.loads(line[5:].strip()), received_ms


def to_point(thing, received_ms):
    """Перетворення події SSE на точку часового ряду."""

    features = thing.get("features", {})
    sync = features.get("sync", {}).get("properties", {})

    if "ts" not in sync or "seq" not in sync:
        return None

    # Час джерела в наносекундах.
    # seq запобігає перезапису точок з однаковою міткою часу.
    time_ns = (
        int(sync["ts"]) * 1_000_000
        + int(sync["seq"]) % 1_000_000
    )

    point = (
        Point("twin_state")
        .tag("thing", thing["thingId"])
        .time(time_ns, write_precision="ns")
    )

    # Числові властивості електроскутера.
    numeric_fields = {
        "speed": ("runningGear", "speed"),
        "rpm": ("motor", "rpm"),
        "temperature": ("motor", "temperature"),
        "current": ("battery", "current"),
        "voltage": ("battery", "voltage"),
        "stateOfCharge": ("battery", "stateOfCharge")
    }

    for field_name, (feature_name, property_name) in numeric_fields.items():
        properties = features.get(feature_name, {}).get("properties", {})

        if property_name in properties:
            point.field(field_name, float(properties[property_name]))

    # Логічні властивості.
    brakes = features.get("brakes", {}).get("properties", {})
    security = features.get("security", {}).get("properties", {})

    if "active" in brakes:
        point.field("brakes_active", bool(brakes["active"]))

    if "locked" in security:
        point.field("security_locked", bool(security["locked"]))

    # Службові поля.
    point.field("seq", int(sync["seq"]))
    point.field("sync_ms", float(received_ms - int(sync["ts"])))

    if "_revision" in thing:
        point.field("revision", int(thing["_revision"]))

    return point


def main():
    options = WriteOptions(
        batch_size=500,
        flush_interval=1000
    )

    count = 0

    with InfluxDBClient(**INFLUX) as client:
        with client.write_api(write_options=options) as writer:
            try:
                for thing, received in events():
                    point = to_point(thing, received)

                    if point is not None:
                        writer.write(
                            bucket=BUCKET,
                            record=point
                        )
                        count += 1

            except KeyboardInterrupt:
                print("\nЗупинка історика...")

    print(f"Записано станів: {count}")


if __name__ == "__main__":
    main()
