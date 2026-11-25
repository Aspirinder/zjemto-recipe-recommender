
import os
import json
import redis
import time


# Redis Cloud connection settings
REDIS_HOST = os.getenv("REDIS_HOST", "pizzas-silica-yearly-60998.db.redis.io")
REDIS_PORT = int(os.getenv("REDIS_PORT", 10639))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD")

REDIS_AVAILABLE = False
redis_client = None


# Initialize Redis connection
try:
    redis_client = redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASSWORD,
        ssl=False,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2
    )

    redis_client.ping()
    REDIS_AVAILABLE = True

except (redis.RedisError, OSError) as e:
    REDIS_AVAILABLE = False
    print(f"Redis unavailable: {e}")


# Get excluded recipes based on user allergies
def get_excluded_recipe_ids(cursor, allergies: list[str]) -> list[int]:

    if not allergies:
        return [] 

    sorted_allergies = sorted(set(allergies))
    cache_key = "blacklist:v2:" + ":".join(sorted_allergies)

    if REDIS_AVAILABLE:
        try:
            redis_start = time.perf_counter()

            cached_data = redis_client.get(cache_key)

            print(f"[REDIS] GET: {time.perf_counter() - redis_start:.3f}s "f"| HIT={cached_data is not None}",flush=True)
            if cached_data:
                parse_start = time.perf_counter()
                result = json.loads(cached_data)
                print(f"[REDIS] JSON decode: {time.perf_counter() - parse_start:.3f}s "f"| IDs={len(result)}",flush=True)
                return result
        except Exception:
            pass

    cursor.execute("""SELECT DISTINCT recipe_id FROM recipe_allergens WHERE allergen_tag = ANY(%s::text[]);""", (sorted_allergies,))
    rows = cursor.fetchall()
    excluded_ids = [row['recipe_id'] for row in rows]

    if REDIS_AVAILABLE:
        try:
            redis_client.set(cache_key, json.dumps(excluded_ids), ex=3600)
        except Exception:
            pass

    return excluded_ids
