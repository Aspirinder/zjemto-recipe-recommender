"""
Performance and user preference vector stability benchmark for ZjemTo API.
Simulates user initialization, calibration recipe fetching, and 200 sequential
swipe actions while tracking HTTP latency and PostgreSQL JSON vector growth.
"""

import json
import os
import random
import time
import psycopg2
from psycopg2.extras import RealDictCursor
import requests

# === CONFIGURATION ===
BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000")
TOTAL_SWIPES = 200
REPORT_EVERY = 10

# Azure PostgreSQL credentials (used only to inspect vector size out-of-band).
# Leave DB_PASS empty to skip DB inspection and measure HTTP latency only.
DB_PASS = os.getenv("DB_PASS", "")
DB_CONFIG = {
    "host": "zjemto-db-server-norway.postgres.database.azure.com",
    "user": "zjemtoadmin",
    "password": DB_PASS,
    "dbname": "postgres",
    "sslmode": "require",
}

INIT_USER_URL = f"{BASE_URL}/api/users/init"
CALIBRATION_URL = f"{BASE_URL}/api/recipes/calibration/{{user_id}}"
SWIPE_URL = f"{BASE_URL}/api/swipe"


def create_test_user(session: requests.Session) -> str:
    """Initialize a new test user via the API and return their UUID."""
    t0 = time.perf_counter()
    resp = session.post(INIT_USER_URL, timeout=15)
    resp.raise_for_status()
    dt_ms = (time.perf_counter() - t0) * 1000

    user_id = str(resp.json()["user_id"])
    print(f"[1/3] Created test user_id={user_id} in {dt_ms:.1f} ms")
    return user_id


def collect_recipes(session: requests.Session, user_id: str, target_count: int) -> list[int]:
    """Fetch batches of calibration recipes until reaching the target count."""
    unique_ids = []
    seen = set()
    attempts = 0

    t_start = time.perf_counter()
    while len(unique_ids) < target_count and attempts < 30:
        attempts += 1
        resp = session.get(CALIBRATION_URL.format(user_id=user_id), timeout=15)
        resp.raise_for_status()

        recipes = resp.json().get("recipes", [])
        if not recipes:
            break

        for r in recipes:
            rid = r["recipe_id"]
            if rid not in seen:
                seen.add(rid)
                unique_ids.append(rid)
                if len(unique_ids) >= target_count:
                    break

    total_ms = (time.perf_counter() - t_start) * 1000
    print(f"[2/3] Collected {len(unique_ids)} unique recipes in {attempts} requests ({total_ms:.1f} ms)")
    return unique_ids


def get_vector_stats(db_cursor, user_id: str) -> str:
    """Read profile_vector directly from PostgreSQL to report key count, payload size, and weight bounds."""
    if not db_cursor:
        return "DB_PASS not set (skipped)"

    db_cursor.execute("SELECT profile_vector FROM users WHERE user_id = %s;", (user_id,))
    row = db_cursor.fetchone()
    vec = row["profile_vector"] if row and row.get("profile_vector") else {}

    if isinstance(vec, str):
        vec = json.loads(vec)

    if not vec:
        return "keys:   0 | size: 0.00 KB"

    raw_bytes = len(json.dumps(vec).encode("utf-8"))
    weights = list(vec.values())
    return (
        f"keys: {len(vec):>3} | "
        f"size: {raw_bytes / 1024:.2f} KB | "
        f"min/max: {min(weights):+.3f} / {max(weights):+.3f}"
    )


def run_benchmark():
    """Execute the full swipe benchmark and print periodic latency and vector metrics."""
    db_conn = None
    db_cursor = None
    if DB_PASS:
        db_conn = psycopg2.connect(**DB_CONFIG)
        db_cursor = db_conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Reuse a single TCP/TLS session to isolate API processing time from handshake overhead
        with requests.Session() as session:
            user_id = create_test_user(session)
            recipe_ids = collect_recipes(session, user_id, TOTAL_SWIPES)

            if not recipe_ids:
                print("Error: No recipes returned from calibration endpoint.")
                return

            # Pad the list with random samples if fewer than TOTAL_SWIPES unique recipes exist
            while len(recipe_ids) < TOTAL_SWIPES:
                recipe_ids.append(random.choice(recipe_ids))

            print(f"\n[3/3] Running {TOTAL_SWIPES} random swipes (70% like / 30% dislike)...\n")
            print(f"{'Step':>7} | {'Avg Latency (10)':>16} | {'Min / Max (ms)':>16} | DB profile_vector State")
            print("-" * 92)

            all_latencies = []
            window_latencies = []

            for step, recipe_id in enumerate(recipe_ids[:TOTAL_SWIPES], start=1):
                action = random.choices(["like", "dislike"], weights=[0.7, 0.3])[0]
                payload = {
                    "user_id": user_id,
                    "recipe_id": int(recipe_id),
                    "action": action,
                }

                t0 = time.perf_counter()
                resp = session.post(SWIPE_URL, json=payload, timeout=15)
                resp.raise_for_status()
                dt_ms = (time.perf_counter() - t0) * 1000

                all_latencies.append(dt_ms)
                window_latencies.append(dt_ms)

                if step % REPORT_EVERY == 0:
                    avg_w = sum(window_latencies) / len(window_latencies)
                    min_w = min(window_latencies)
                    max_w = max(window_latencies)
                    vec_info = get_vector_stats(db_cursor, user_id)

                    print(f"{step:>3}/{TOTAL_SWIPES} | {avg_w:>13.1f} ms | {min_w:>6.1f} / {max_w:<6.1f} | {vec_info}")
                    window_latencies.clear()

            sorted_lat = sorted(all_latencies)
            p95 = sorted_lat[int(len(sorted_lat) * 0.95)]
            first_10 = sum(all_latencies[:10]) / 10
            last_10 = sum(all_latencies[-10:]) / 10

            print("-" * 92)
            print(f"Summary for {TOTAL_SWIPES} swipes:")
            print(f"  Total time:          {sum(all_latencies) / 1000:.2f} s")
            print(f"  Average latency:     {sum(all_latencies) / len(all_latencies):.1f} ms (P95: {p95:.1f} ms)")
            print(f"  First 10 vs Last 10: {first_10:.1f} ms -> {last_10:.1f} ms")
    finally:
        if db_cursor:
            db_cursor.close()
        if db_conn:
            db_conn.close()


if __name__ == "__main__":
    run_benchmark()