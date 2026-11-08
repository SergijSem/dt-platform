
"""Навантажувальне тестування MQTT-каналу цифрового двійника електроскутера."""

import csv
import itertools
import json
import os
import time

import paho.mqtt.client as mqtt
from locust import LoadTestShape, User, constant_throughput, task


TOPIC = "pzks/scooter-1/telemetry"

RATE = 5
STEPS = [1, 2, 5, 10, 20, 40, 80]
STEP_TIME = int(os.getenv("STEP_TIME", "60"))

SEQ = itertools.count(1_000_000)

LOG_FILE = open("results/sent.csv", "w", newline="", encoding="utf-8")
LOG = csv.writer(LOG_FILE)
LOG.writerow(["seq", "ts", "rate"])


class Gateway(User):
    """Імітація одного MQTT-шлюзу."""

    wait_time = constant_throughput(RATE)

    def on_start(self):
        self.client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2
        )
        self.client.connect("localhost", 1883)
        self.client.loop_start()

    def on_stop(self):
        self.client.loop_stop()
        self.client.disconnect()

    @task
    def publish(self):
        msg = {
            "seq": next(SEQ),
            "ts": int(time.time() * 1000),
            "v": 25.0,
            "rpm": 1300,
            "i": 15.0,
            "u": 48.0,
            "temp": 45.0,
            "soc": 79.0,
            "brk": False,
            "lck": False
        }

        start = time.perf_counter()

        error = None

        try:
            info = self.client.publish(
                TOPIC,
                json.dumps(msg),
                qos=1
            )
            info.wait_for_publish(timeout=5)

            if not info.is_published():
                error = TimeoutError("Немає PUBACK")

        except Exception as exc:
            error = exc

        rate = self.environment.runner.user_count * RATE

        LOG.writerow([
            msg["seq"],
            msg["ts"],
            rate
        ])

        self.environment.events.request.fire(
            request_type="MQTT",
            name="publish",
            response_length=0,
            response_time=(time.perf_counter() - start) * 1000,
            exception=error
        )


class Steps(LoadTestShape):
    """Ступінчасте збільшення кількості MQTT-шлюзів."""

    def tick(self):
        step = int(self.get_run_time() // STEP_TIME)

        if step >= len(STEPS):
            LOG_FILE.flush()
            return None

        return STEPS[step], 100
