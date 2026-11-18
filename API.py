from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import requests
from pydantic import BaseModel, EmailStr
import psycopg2
from psycopg2 import pool, IntegrityError
from psycopg2.extras import RealDictCursor
from typing import Literal
import json
import os
import random
import redis
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
import csv

ph = PasswordHasher()


app = FastAPI(title = "ZjemTo API", version = "7.0", description = "Fixed bugs add liked recipes")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Azure PostgreSQL connection settings
DB_HOST = "zjemto-db-server-norway.postgres.database.azure.com"
DB_USER = "zjemtoadmin"
DB_PASS = os.getenv("DB_PASS", "local_pass")  # Use environment variable for password
DB_NAME = "postgres"

db_pool = pool.ThreadedConnectionPool(
    minconn=1,
    maxconn=10,
    host=DB_HOST,
    user=DB_USER,
    password=DB_PASS,
    dbname=DB_NAME,
    sslmode='require'
)

def get_db_connection():
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1;")
    except psycopg2.Error:
        db_pool.putconn(conn, close=True)
        conn = db_pool.getconn()
    return conn

def release_db_connection(conn):
    if conn:
        conn.rollback()  # Rollback any uncommitted transactions
        db_pool.putconn(conn)


# Redis Cloud connection settings
REDIS_HOST = os.getenv("REDIS_HOST", "pizzas-silica-yearly-60998.db.redis.io")
REDIS_PORT = int(os.getenv("REDIS_PORT", 10639))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "local_redis_pass")

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

class UserSignRequest(BaseModel):
    user_email: EmailStr
    user_password: str

class UserAllergiesRequest(BaseModel):
    allergies: list[str]


#Function to get top recommended recipes from ML API
def get_top_recipes(user_vector, swiped_ids, excluded_recipe_ids, limit=10) -> list[int]:

    if not user_vector:
        return []

    ml_api_url = "https://zjemto-ml-engine-bfcqgfh4hvc6g2fa.norwayeast-01.azurewebsites.net/api/recommend"

    try:
        send_data = {
            "user_vector": user_vector,
            "swiped_ids": swiped_ids,
            "excluded_recipe_ids": excluded_recipe_ids,
            "limit": limit
        }
        response = requests.post(ml_api_url, json=send_data, timeout=45.0)

        response.raise_for_status()

        data = response.json()

        return data.get("recommended_recipe_ids", [])
    
    except (requests.exceptions.RequestException, ValueError) as e:
        print(f"Error calling ML API: {e}")

        raise HTTPException(status_code=503, detail="Recommendation service unavailable")


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
    

#Get calibration recipes for a user
def get_calibration_recipes(cursor, user_id: str, allergies: list[str] = [], swipes_done: int = 0):
        
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

    if swipes_done > 0:
        cursor.execute('''SELECT recipe_id FROM user_swipes WHERE user_id = %s LIMIT %s;''', (user_id, swipes_done))
        swiped_rows = cursor.fetchall()
        swiped_ids = {row['recipe_id'] for row in swiped_rows}
        fetched_ids.update(swiped_ids)

    while len(recipes) < 20-swipes_done and attempts < max_attempts:
        attempts += 1

        random_ids = random.sample(range(min_id, max_id + 1), min(50, max_id - min_id + 1))
        valid_ids = [rid for rid in random_ids if rid not in excluded_ids and rid not in fetched_ids]

        if not valid_ids:
            continue

        fetched_ids.update(valid_ids)
        need_count = (20 - swipes_done) - len(recipes)

        cursor.execute('''SELECT recipe_id, name, image_url, description, category, ingredient_parts, 
        ingredient_quantities, instructions, total_time, calories, protein, fat, carbs FROM food_recipes WHERE recipe_id = ANY(%s) LIMIT %s;''', (valid_ids, need_count))

        buffor_recipes = cursor.fetchall()
        if buffor_recipes:
            recipes.extend(buffor_recipes)

    return {"recipes": format_recipes(recipes)}


def parse_recipe_list(value):
    if not value:
        return []
    if isinstance(value, list):
        return value

    value = value.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")

    
    return next(csv.reader([value], skipinitialspace=True), [])

def format_recipes(recipes):
    for recipe in recipes:
        for field in (
            "ingredient_parts",
            "ingredient_quantities",
            "instructions"
        ):
            recipe[field] = parse_recipe_list(
                recipe.get(field)
            )

    return recipes


@app.get("/")
def root():
    return {"status": "200", "service": "ZjemTo API"}


@app.post("/api/users/signup", status_code=201)
def sign_up_user(requestData: UserSignRequest):
    user_email = str(requestData.user_email).strip().lower()

    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cursor.execute("SELECT 1 as is_user FROM users where user_email=%s LIMIT 1;", (user_email,))

        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="User already exists")

        hash_password = ph.hash(requestData.user_password)

        cursor.execute("INSERT INTO users (user_email, hash_password) VALUES (%s, %s) RETURNING user_id;", (user_email, hash_password))
        user_id = cursor.fetchone()
        conn.commit()
        return {"status": "success", "user_id": user_id['user_id']}
    except IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409, detail="User already exists")
    finally:
        cursor.close()
        release_db_connection(conn)


@app.post("/api/users/signin")
def sign_in_user(requestData: UserSignRequest):
    user_email = str(requestData.user_email).strip().lower()

    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cursor.execute("SELECT hash_password, user_id FROM users where user_email=%s LIMIT 1;", (user_email,))
        data = cursor.fetchone()

        if not data:
            raise HTTPException(status_code=401, detail="Invalid email or password")
        

        ph.verify(data.get("hash_password"), requestData.user_password)

        return {"status": "success", "user_id": data['user_id']}
    except VerifyMismatchError:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    finally:
        cursor.close()
        release_db_connection(conn)


@app.get("/api/users/{user_id}/allergies")
def get_user_allergies(user_id: str):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cursor.execute("SELECT allergies FROM users WHERE user_id = %s;",(user_id,))

        user = cursor.fetchone()

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        return {"allergies": user["allergies"] or []}

    finally:
        cursor.close()
        release_db_connection(conn)


@app.put("/api/users/{user_id}/allergies")
def update_user_allergies(user_id: str,requestData: UserAllergiesRequest):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        allergies = list(dict.fromkeys(requestData.allergies))

        cursor.execute("""UPDATE users SET allergies = %s WHERE user_id = %s RETURNING allergies;""",(allergies, user_id))

        user = cursor.fetchone()

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        conn.commit()

        return {"status": "success","allergies": user["allergies"]}

    finally:
        cursor.close()
        release_db_connection(conn)


@app.get("/api/recipes/feed/{user_id}")
def get_recipe_feed(user_id: str):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cursor.execute("SELECT is_calibrated, profile_vector, allergies FROM users WHERE user_id = %s;", (user_id,))
        user_data = cursor.fetchone()

        if not user_data:
            raise HTTPException(status_code=404, detail="User not found")

        is_calibrated = bool(user_data.get('is_calibrated'))
        user_vector = user_data.get('profile_vector') or {}
        allergies = user_data.get('allergies') or []

        if not is_calibrated or not user_vector:

            if is_calibrated and not user_vector:
                raise HTTPException(status_code=409, detail="User calibrated but profile vector is empty")
            
            cursor.execute("SELECT count(*) as total_swipes FROM (SELECT 1 FROM user_swipes WHERE user_id = %s LIMIT 20) sub;", (user_id,))
            swipes_done = cursor.fetchone()['total_swipes']

            next_swipes = get_calibration_recipes(cursor, user_id, allergies, swipes_done)

            return {
                "mode": "calibration",
                "is_calibrated": False,
                "calibration_progress": {"current_swipes": swipes_done, "total_required": 20},
                "recipes": next_swipes.get("recipes")
            }

        cursor.execute("SELECT recipe_id from user_swipes WHERE user_id = %s;", (user_id,))
        swiped_ids = [row['recipe_id'] for row in cursor.fetchall()]

        excluded_recipe_ids = get_excluded_recipe_ids(cursor, allergies)
        recommended_recipe_ids = get_top_recipes(user_vector, swiped_ids, excluded_recipe_ids, limit=10)

        cursor.execute('''SELECT recipe_id, name, image_url, description, category, ingredient_parts, 
        ingredient_quantities, instructions, total_time, calories, protein, fat, carbs FROM food_recipes WHERE recipe_id = ANY(%s);''',
                       (recommended_recipe_ids,))

        candidate_recipes = cursor.fetchall()
        
        candidate_recipes.sort(key=lambda r: recommended_recipe_ids.index(r['recipe_id']))

        return {
            "mode": "personalized",
            "is_calibrated": True,
            "recipes": format_recipes(candidate_recipes)
        }
    finally:
        cursor.close()
        release_db_connection(conn)


@app.get("/api/users/{user_id}/liked-recipes")
def get_liked_recipes(user_id: str):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cursor.execute("SELECT 1 FROM users WHERE user_id = %s;",(user_id,))

        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

        cursor.execute("""SELECT r.recipe_id, r.name, r.image_url, r.description, r.category, r.ingredient_parts, r.ingredient_quantities, r.instructions,
                r.total_time, r.calories, r.protein, r.fat, r.carbs FROM user_favorites AS f JOIN food_recipes AS r ON r.recipe_id = f.recipe_id
                    WHERE f.user_id = %s ORDER BY f.created_at DESC;""",(user_id,))

        recipes = cursor.fetchall()

        return {"recipes": format_recipes(recipes)}

    finally:
        cursor.close()
        release_db_connection(conn)


@app.delete("/api/users/{user_id}/liked-recipes/{recipe_id}")
def delete_liked_recipes(user_id: str, recipe_id: str):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cursor.execute("SELECT 1 FROM users WHERE user_id = %s;",(user_id,))

        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

        cursor.execute("DELETE FROM user_favorites WHERE user_id = %s AND recipe_id = %s RETURNING recipe_id;",(user_id, recipe_id))

        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Recipe not found")
        

        conn.commit()

        return {"status": "success"}

    finally:
        cursor.close()
        release_db_connection(conn)
        

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

        cursor.execute("INSERT INTO user_swipes (user_id, recipe_id, action) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING RETURNING recipe_id;",
            (swipe.user_id, swipe.recipe_id, swipe.action)
        )

        inserted = cursor.fetchone()

        is_calibrated = user_data['is_calibrated'] if user_data else False

        if not inserted:
            return {"status" : "already_recorded", "is_calibrated" : is_calibrated}

        if swipe.action == "like": 
            cursor.execute("""INSERT INTO user_favorites (user_id, recipe_id) VALUES (%s, %s) ON CONFLICT DO NOTHING;""",(swipe.user_id, swipe.recipe_id))


        if not is_calibrated:
            cursor.execute('''SELECT count(*) as total_swipes FROM (SELECT 1 FROM user_swipes WHERE user_id = %s LIMIT 20) sub;''', (swipe.user_id,))
            swipe_count = cursor.fetchone()['total_swipes']

            if swipe_count >= 20:
                cursor.execute("UPDATE users SET is_calibrated = TRUE WHERE user_id = %s", (swipe.user_id,))
                is_calibrated = True


        if swipe.action in ("like", "dislike"):
            cursor.execute("SELECT tfidf_vector FROM food_recipes WHERE recipe_id = %s;", (swipe.recipe_id,))
            recipe_res = cursor.fetchone()

            cursor.execute("SELECT profile_vector FROM users WHERE user_id = %s;", (swipe.user_id,))
            user_res = cursor.fetchone()

            if recipe_res and user_res:
                recipe_vector = recipe_res['tfidf_vector'] or {}
                user_vector = user_res['profile_vector'] or {}

                for i in user_vector:
                    user_vector[i] *= 0.9

                for ingredient, weight in recipe_vector.items():
                    current_weight = user_vector.get(ingredient, 0.0)

                    if swipe.action == "like":
                        new_weight = current_weight + weight
                    else:  # dislike
                        penalty = weight * (0.125 if current_weight > 0.5 else 0.25)
                        new_weight = max(current_weight - penalty, -1.0)

                    user_vector[ingredient] = new_weight

                #top_ingredients = sorted(user_vector.items(), key=lambda x: x[1], reverse=True)[:150]
                user_vector = {i: round(v, 4) for i, v in user_vector.items() if abs(v) > 0.01}

                cursor.execute("UPDATE users SET profile_vector = %s WHERE user_id = %s;",(json.dumps(user_vector), swipe.user_id))
        conn.commit()
        return {"status": "success", "is_calibrated": is_calibrated}
    finally:
        cursor.close()
        release_db_connection(conn)