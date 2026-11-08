"""
Емулятор сенсорів електроскутера: публікує телеметрію через MQTT.

Запуск із кореня репозиторію:
python emulator/emulator.py --rate 1 --count 5

Кожне повідомлення записується також у results/source.csv.
"""

import argparse
import csv
import json
import math
import random
import time
from pathlib import Path

import paho.mqtt.client as mqtt


BROKER, PORT = "localhost", 1883


def sample(t, elapsed):
    """Один відлік усіх сигналів електроскутера у форматі пристрою."""

    # Імітація зміни швидкості під час руху.
    speed = max(0.0, min(50.0,
                         25 + 20 * math.sin(2 * math.pi * t / 60)))

    # Оберти двигуна залежать від швидкості.
    rpm = max(0, min(3000, int(speed * 55 + random.gauss(0, 20))))

    # Струм залежить від навантаження двигуна.
    current = max(0.0, min(50.0,
                           5 + speed * 0.55 + random.gauss(0, 0.5)))

    # Напруга акумулятора.
    voltage = max(36.0, min(54.6,
                            48.0 + random.gauss(0, 0.1)))

    # Температура двигуна.
    temperature = max(-20.0, min(120.0,
                                 35 + current * 0.7
                                 + random.gauss(0, 0.2)))

    # Рівень заряду залежить від часу та навантаження.
    soc = max(0.0, 80.0 - elapsed * current / 20 / 3600 * 100) 

    return {
        "v": round(speed, 2),
        "rpm": rpm,
        "i": round(current, 2),
        "u": round(voltage, 2),
        "temp": round(temperature, 2),
        "soc": round(soc, 2),
        "brk": random.random() < 0.05,
        "lck": False
    }


def main():
    ap = argparse.ArgumentParser(
        description="Емулятор сенсорів електроскутера"
    )

    ap.add_argument(
        "--name",
        default="scooter-1",
        help="ім'я двійника"
    )

    ap.add_argument(
        "--rate",
        type=float,
        default=1.0,
        help="кількість повідомлень за секунду"
    )

    ap.add_argument(
        "--count",
        type=int,
        default=0,
        help="кількість повідомлень; 0 — без обмеження"
    )

    args = ap.parse_args()

    if args.rate <= 0:
        ap.error("--rate має бути більше нуля")

    if args.count < 0:
        ap.error("--count не може бути від'ємним")

    topic = f"pzks/{args.name}/telemetry"

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.connect(BROKER, PORT)
    client.loop_start()

    print(
        f"Публікація в {topic}, "
        f"{args.rate} повідомл./с. Ctrl+C — зупинка"
    )

    period = 1 / args.rate
    seq = 0
    next_time = time.time()
    start_time = time.time()

    # Підготовка CSV-файлу.
    output_path = Path("results/source.csv")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            log = csv.writer(f, delimiter=";")
            log.writerow([
                "seq", "ts", "v", "rpm", "i",
                "u", "temp", "soc", "brk", "lck"
            ])

            while args.count == 0 or seq < args.count:
                seq += 1
                now = time.time()

                msg = {
                    "seq": seq,
                    "ts": int(now * 1000),
                    **sample(now, now - start_time)
                }

                payload = json.dumps(msg, ensure_ascii=False)

                # Публікація повідомлення з QoS 1.
                result = client.publish(topic, payload, qos=1)
                result.wait_for_publish()

                # Запис того самого повідомлення у CSV.
                log.writerow(msg.values())
                f.flush()

                print(payload)

                next_time += period
                time.sleep(max(0.0, next_time - time.time()))

    except KeyboardInterrupt:
        pass

    finally:
        client.loop_stop()
        client.disconnect()

    print(f"Надіслано повідомлень: {seq}")


if __name__ == "__main__":
    main()
