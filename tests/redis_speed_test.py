"""
Benchmark script comparing allergen blacklist lookup latency between
Azure PostgreSQL (cold query) and Redis Cloud (warm cache hit).
"""

import json
import os
import time
import psycopg2
from psycopg2.extras import RealDictCursor
import redis

# --- CONNECTION SETTINGS ---
DB_HOST = "zjemto-db-server-norway.postgres.database.azure.com"
DB_USER = "zjemtoadmin"
DB_PASS = os.getenv("DB_PASS", "")  # Use environment variable for security
DB_NAME = "postgres"

REDIS_HOST = os.getenv("REDIS_HOST", "pizzas-silica-yearly-60998.db.redis.io")
REDIS_PORT = int(os.getenv("REDIS_PORT", 10639))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")

# Initialize Redis client with graceful fallback to PostgreSQL if unavailable
try:
    redis_client = redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASSWORD,
        ssl_cert_reqs=None,
        decode_responses=True,
        socket_connect_timeout=2,
    )
    redis_client.ping()
    REDIS_AVAILABLE = True
except Exception:
    REDIS_AVAILABLE = False
    print("⚠️ Warning: Redis is unavailable. Falling back to direct PostgreSQL queries.")


def get_excluded_recipe_ids_optimized(cursor, allergies: list[str]) -> tuple[list[int], str]:
    """Fetch excluded recipe IDs using Redis cache with PostgreSQL fallback."""
    if not allergies:
        return [], "Skipped (No allergies)"

    # 1. Sort allergies so ('nuts', 'dairy') and ('dairy', 'nuts') share the same cache key
    sorted_allergies = sorted(allergies)
    cache_key = f"blacklist:{'_'.join(sorted_allergies)}"

    # 2. Try fetching from Redis cache first
    if REDIS_AVAILABLE:
        try:
            cached_data = redis_client.get(cache_key)
            if cached_data:
                return json.loads(cached_data), "REDIS (Cache Hit 🚀)"
        except Exception:
            pass

    # 3. Cache miss: query PostgreSQL (uses composite index on allergen_tag)
    query = """
        SELECT DISTINCT recipe_id
        FROM recipe_allergens
        WHERE allergen_tag = ANY(%s);
    """
    cursor.execute(query, (sorted_allergies,))
    excluded_ids = [row["recipe_id"] for row in cursor.fetchall()]

    # 4. Store result in Redis with a 1-hour (3600s) TTL
    if REDIS_AVAILABLE:
        try:
            redis_client.setex(cache_key, 3600, json.dumps(excluded_ids))
        except Exception:
            pass

    return excluded_ids, "PostgreSQL (DB Query 💾)"


def run_benchmark(user_id: str):
    conn = psycopg2.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASS,
        dbname=DB_NAME,
        sslmode="require",
    )
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        print(f"⏱️ Running benchmark for user_id: {user_id}")

        start_time = time.perf_counter()

        # 1. Fetch user's allergy list
        cursor.execute("SELECT allergies FROM users WHERE user_id = %s;", (user_id,))
        user_res = cursor.fetchone()

        if not user_res:
            print("❌ Error: User not found in database.")
            return

        allergies = user_res["allergies"] or []
        print(f"   📋 Allergies: {allergies if allergies else 'none (empty list)'}")

        # 2. Fetch excluded recipe IDs (via Redis cache or PostgreSQL)
        excluded_ids, source_type = get_excluded_recipe_ids_optimized(cursor, allergies)

        end_time = time.perf_counter()
        elapsed_ms = (end_time - start_time) * 1000

        print("\n📊 RESULTS:")
        print(f"   ⏱️ Execution time:      {elapsed_ms:.2f} ms")
        print(f"   📦 Data source:         {source_type}")
        print(f"   🚫 Blacklisted recipes: {len(excluded_ids)}")

    except Exception as e:
        print(f"❌ Execution error: {e}")
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    test_user_id = os.getenv("TEST_USER_ID", "93821cfc-7ddc-4dd7-98aa-d0da25624a6c")

    print("--- Run 1: Cold start / PostgreSQL lookup ---")
    run_benchmark(test_user_id)

    print("\n--- Run 2: Warm cache / Redis lookup ---")
    run_benchmark(test_user_id)