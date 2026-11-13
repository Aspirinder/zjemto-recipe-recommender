from fastapi import FastAPI, HTTPException
import requests
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Literal
import json
import os
import random
import redis

app = FastAPI(title = "ZjemTo API", version = "3.3")

# Azure PostgreSQL connection settings
DB_HOST = "zjemto-db-server-norway.postgres.database.azure.com"
DB_USER = "zjemtoadmin"
DB_PASS = os.getenv("DB_PASS", "local_pass")  # Use environment variable for password
DB_NAME = "postgres"

def get_db_connection():
    return psycopg2.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, dbname=DB_NAME, sslmode='require')


# Redis Cloud connection settings
REDIS_HOST = os.getenv("REDIS_HOST", "pizzas-silica-yearly-60998.db.redis.io")
REDIS_PORT = int(os.getenv("REDIS_PORT", 10639))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "local_pass")

REDIS_AVAILABLE = False
redis_client = None

try:
    redis_client = redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASSWORD,
        ssl_cert_reqs=None,       # Skip strict certificate verification
        decode_responses=True,
        socket_connect_timeout=2 
    )

    redis_client.ping()
    REDIS_AVAILABLE = True
except Exception as e:
    REDIS_AVAILABLE = False
    print(f"Error connecting to Redis: {e}")


class SwipeRequest(BaseModel):
    user_id: str
    recipe_id: int
    action: Literal["like", "dislike"]  # "like" or "dislike"


# Function to get excluded recipe IDs based on user allergies
def get_excluded_recipe_ids(cursor, allergies: list[str]) -> list[int]:

    if not allergies:
            return [] 

    sorted_allergies = sorted(allergies)
    cache_key = f"blacklist:{'_'.join(sorted_allergies)}"

    if REDIS_AVAILABLE:
        try:
            cached_data = redis_client.get(cache_key)
            if cached_data:
                return json.loads(cached_data)
        except Exception:
            pass

    query = """
        SELECT r.recipe_id 
        FROM food_recipes r
        WHERE EXISTS (
            SELECT 1 
            FROM recipe_allergens ra 
            WHERE ra.recipe_id = r.recipe_id 
              AND ra.allergen_tag = ANY(%s)
        );
    """
    cursor.execute(query, (sorted_allergies,))
    rows = cursor.fetchall()
    excluded_ids = [row['recipe_id'] for row in rows]

    if REDIS_AVAILABLE:
        try:
            redis_client.set(cache_key, json.dumps(excluded_ids), ex=3600)
        except Exception:
            pass

    return excluded_ids


#Function to get top recommended recipes from ML API
def get_top_recipes(user_vector, swiped_ids, excluded_recipe_ids, limit=10) -> list[int]:

    if not user_vector:
        return []

    ml_api_url = "https://zjemto-ml-engine.azurewebsites.net/api/recommend"

    try:
        send_data = {
            "user_vector": user_vector,
            "swiped_ids": swiped_ids,
            "excluded_recipe_ids": excluded_recipe_ids,
            "limit": limit
        }
        response = requests.post(ml_api_url, json=send_data, timeout=3.0)

        if response.status_code == 200:
            data = response.json()
            return data.get("recommended_recipe_ids", [])
    except requests.exceptions.RequestException as e:
        print(f"Error calling ML API: {e}")

    return []
    

#Create user
@app.post("/api/users/init")
def create_user():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute("INSERT INTO users DEFAULT VALUES RETURNING user_id;")
        user_id = cursor.fetchone()
        conn.commit()
        return {"user_id": user_id['user_id']}
    finally:
        cursor.close()
        conn.close()


#Get calibration recipes for a user
@app.get("/api/recipes/calibration/{user_id}")
def get_calibration_recipes(user_id: str):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute("SELECT allergies FROM users WHERE user_id = %s;", (user_id,))
        user_res = cursor.fetchone()
        allergies = user_res['allergies'] if user_res and user_res.get('allergies') else []

        excluded_ids = get_excluded_recipe_ids(cursor, allergies)

        cursor.execute('SELECT MIN(recipe_id) AS min_id, MAX(recipe_id) AS max_id FROM food_recipes;')
        bounds = cursor.fetchone()

        if not bounds or bounds['min_id'] is None or bounds['max_id'] is None:
            return {"recipes": []}

        min_id, max_id = bounds['min_id'], bounds['max_id'] 

        recipes = []
        fetched_ids = set()
        max_attempts = 15
        attempts = 0

        while len(recipes) < 20 and attempts < max_attempts:
            attempts += 1

            random_ids = random.sample(range(min_id, max_id + 1), min(50, max_id - min_id + 1))
            valid_ids = [rid for rid in random_ids if rid not in excluded_ids and rid not in fetched_ids]

            if not valid_ids:
                continue

            fetched_ids.update(valid_ids)
            need_count = 20 - len(recipes)

            cursor.execute('''SELECT recipe_id, name, image_url, ingredient_parts,
            total_time FROM food_recipes WHERE recipe_id = ANY(%s) LIMIT %s;''', (valid_ids, need_count))

            buffor_recipes = cursor.fetchall()
            if buffor_recipes:
                recipes.extend(buffor_recipes)

        for r in recipes:
            if r['ingredient_parts']:
                r['ingredient_parts'] = r["ingredient_parts"].replace('"', '').split(", ")

        return {"recipes": recipes}
    finally:
        cursor.close()
        conn.close()

#Swipe recording and user profile update
@app.post("/api/swipe")
def record_swipe(swipe: SwipeRequest):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cursor.execute("SELECT user_id, is_calibrated FROM users WHERE user_id = %s;", (swipe.user_id,))
        user_data = cursor.fetchone()
        if not user_data:
            raise HTTPException(status_code=404, detail="User not found")

        cursor.execute("INSERT INTO user_swipes (user_id, recipe_id, action) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING;",
            (swipe.user_id, swipe.recipe_id, swipe.action)
        )

        is_calibrated = user_data['is_calibrated'] if user_data else False

        if not is_calibrated:
            cursor.execute('''SELECT count(*) as total_swipes FROM (SELECT 1 FROM user_swipes WHERE user_id = %s LIMIT 20) sub;''', (swipe.user_id,))
            swipe_count = cursor.fetchone()['total_swipes']

            if swipe_count >= 20:
                cursor.execute("UPDATE users SET is_calibrated = TRUE WHERE user_id = %s", (swipe.user_id,))
                is_calibrated = True


        if swipe.action == "like":
            cursor.execute("SELECT tfidf_vector FROM food_recipes WHERE recipe_id = %s;", (swipe.recipe_id,))
            recipe_res = cursor.fetchone()

            cursor.execute("SELECT profile_vector FROM users WHERE user_id = %s;", (swipe.user_id,))
            user_res = cursor.fetchone()

            if recipe_res and user_res:
                recipe_vector = recipe_res['tfidf_vector'] or {}
                user_vector = user_res['profile_vector'] or {}

                for ingredient, weight in recipe_vector.items():
                    user_vector[ingredient] = (user_vector.get(ingredient, 0)* 0.9) + weight

                cursor.execute("UPDATE users SET profile_vector = %s WHERE user_id = %s;",(json.dumps(user_vector), swipe.user_id))
        conn.commit()
        return {"status": "success", "is_calibrated": is_calibrated}
    finally:
        cursor.close()
        conn.close()


# Personalized recipe recommendation based on user profile
@app.get("/api/recipe/personalized/{user_id}")
def get_personalized_recipes(user_id: str):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cursor.execute("SELECT profile_vector, allergies FROM users WHERE user_id = %s;", (user_id,))
        user_res = cursor.fetchone()

        if not user_res:
            raise HTTPException(status_code=404, detail="User not found")

        if not user_res.get('profile_vector'):
            return get_calibration_recipes(user_id)

        user_vector = user_res['profile_vector']
        allergies = user_res['allergies'] or []

        cursor.execute("SELECT recipe_id from user_swipes WHERE user_id = %s;", (user_id,))
        swiped_rows = cursor.fetchall()
        swiped_ids = [row['recipe_id'] for row in swiped_rows]

        excluded_recipe_ids = get_excluded_recipe_ids(cursor, allergies)

        recomeneded_recipes = get_top_recipes(user_vector, swiped_ids, excluded_recipe_ids, limit=10)

        if not recomeneded_recipes:
            return get_calibration_recipes(user_id)

        cursor.execute("SELECT recipe_id, name, image_url, ingredient_parts, total_time FROM food_recipes WHERE recipe_id = ANY(%s);", 
            (recomeneded_recipes,))

        candidate_recipes = cursor.fetchall()

        candidate_recipes.sort(key=lambda r: recomeneded_recipes.index(r['recipe_id']))

        for r in candidate_recipes:
            if r['ingredient_parts']:
                r['ingredient_parts'] = r["ingredient_parts"].replace('"', '').split(", ")

        return {"recipes": candidate_recipes}
    finally:
        cursor.close()
        conn.close()