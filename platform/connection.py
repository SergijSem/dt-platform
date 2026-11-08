"""Створює або оновлює з'єднання MQTT у Ditto: connection.json + mapping.js."""
import json
from pathlib import Path
import requests

HERE = Path(__file__).parent
URL = "http://localhost:8080/api/2/connections/mqtt-telemetry"
DEVOPS = ("devops", "foobar")  # облікові дані DevOps за замовчуванням


# Завантаження конфігурації з'єднання
conn = json.loads(
    (HERE / "connection.json").read_text(encoding="utf-8")
)
# Завантаження JavaScript-відображення
script = (HERE / "mapping.js").read_text(encoding="utf-8")
# Підстановка скрипту у конфігурацію
conn["mappingDefinitions"]["telemetry"]["options"]["incomingScript"] = script
# Створення або оновлення MQTT-з'єднання
r = requests.put(
    URL,
    json=conn,
    auth=DEVOPS,
    timeout=30
)
print(r.status_code, r.text[:300])
# Перевірка стану з'єднання
status = requests.get(
    URL + "/status",
    auth=DEVOPS,
    timeout=30
).json()
print("Стан з'єднання:", status.get("connectionStatus"))