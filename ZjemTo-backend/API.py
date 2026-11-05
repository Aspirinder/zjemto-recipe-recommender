from fastapi import FastAPI, HTTPException
import requests
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Literal
import json
import os
import random

DB_HOST = "zjemto-db-server-norway.postgres.database.azure.com"
DB_USER = "zjemtoadmin"
DB_PASS = os.getenv("DB_PASS", "local_pass")  # Use environment variable for password
DB_NAME = "postgres"

app = FastAPI(title = "ZjemTo API", version = "2.0")

def get_db_connection():
    return psycopg2.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, dbname=DB_NAME, sslmode='require')

class SwipeRequest(BaseModel):
    user_id: str
    recipe_id: int
    action: Literal["like", "dislike"]  # "like" or "dislike"

#Function to get top recommended recipes from ML API
def get_top_recipes(user_vector, swiped_ids, allergies, limit=10) -> list[int]:

    if not user_vector:
        return []

    ml_api_url = "https://zjemto-ml-engine.azurewebsites.net/api/recommend"

    try:
        send_data = {
            "user_vector": user_vector,
            "swiped_ids": swiped_ids,
            "allergies": allergies,
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


#Cold start recommendation
@app.get("/api/recipes/calibration/{user_id}")
def get_calibration_recipes(user_id: str):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute('SELECT MIN(recipe_id) AS min_id, MAX(recipe_id) AS max_id FROM food_recipes;')
        bounds = cursor.fetchone()

        if not bounds or bounds['min_id'] is None:
            return {"recipes": []}

        min_id = bounds['min_id']
        max_id = bounds['max_id']

        sample_size = min(35, max_id - min_id + 1)

        recipes = []
        fetched_ids = set()
        max_attempts = 10
        attempts = 0

        while len(recipes) < 20 and attempts < max_attempts:
            attempts += 1

            random_ids = random.sample(range(min_id, max_id + 1), sample_size)
            new_ids = [rid for rid in random_ids if rid not in fetched_ids]

            if not new_ids:
                break

            fetched_ids.update(new_ids)

            needed = 20 - len(recipes)

            cursor.execute("SELECT recipe_id, name, image_url, ingredient_parts, total_time FROM food_recipes WHERE recipe_id = ANY(%s) LIMIT %s;", 
            (new_ids, needed))
            buff = cursor.fetchall()

            if not buff:
                continue

            recipes.extend(buff)

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

#Personalized recipe recommendation based on user profile
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

        if not swiped_ids:
            swiped_ids = []

        recomeneded_recipes = get_top_recipes(user_vector, swiped_ids, allergies, limit=10)

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