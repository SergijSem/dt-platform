"""Модель маршруту телеметрії електроскутера."""

# Послідовні ділянки маршруту, мс.
# Значення є початковими оцінками з прикладу завдання.
BASE = {
    "Електроскутер -> DCE": 40,
    "DCE -> DTE": 60,
    "Оброблення на DTE": 90,
    "DTE -> Unity": 150,
}

# Ділянки до платформи для перевірки NFR-01.
SYNC = [
    "Електроскутер -> DCE",
    "DCE -> DTE",
    "Оброблення на DTE",
]

TARGET_SYNC = 250  # NFR-01, мс
TARGET_E2E = 500   # NFR-02, мс

# Гіпотеза Г-01: WebSocket замість опитування API.
# 70 мс — прогнозоване значення, яке треба перевірити вимірюваннями.
HYPOTHESIS = {**BASE, "DTE -> Unity": 70}


def status(value, target):
    return "виконано" if value <= target else "НЕ виконано"


def report(title, route):
    total = sum(route.values())
    sync = sum(route[name] for name in SYNC)

    print(f"\n{title}")

    for name, ms in route.items():
        print(f"  {name:<28} {ms:>4} мс ({ms / total:.0%})")

    print(
        f"  До платформи: {sync} мс; "
        f"ціль NFR-01: {TARGET_SYNC} мс — "
        f"{status(sync, TARGET_SYNC)}"
    )

    print(
        f"  Наскрізна затримка: {total} мс; "
        f"ціль NFR-02: {TARGET_E2E} мс — "
        f"{status(total, TARGET_E2E)}"
    )

    return total


base = report("Базова конфігурація", BASE)
hyp = report("Гіпотеза Г-01 (WebSocket)", HYPOTHESIS)

reduction = (1 - hyp / base) * 100

print(f"\nОчікуване зменшення затримки: {reduction:.1f}%")
print(
    "Гіпотеза досягає 20%: "
    + ("так" if reduction >= 20 else "ні")
)
