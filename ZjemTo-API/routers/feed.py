
import random

from fastapi import APIRouter, HTTPException
from psycopg2.extras import RealDictCursor

from database import get_db_connection, release_db_connection
from services.ml import get_top_recipes
from services.allergens import get_excluded_recipe_ids
from services.recipes import format_recipes


router = APIRouter(prefix="/api/recipes", tags=["Feed"])


RECIPE_FIELDS = """
    recipe_id, name, image_url, description, category,
    keywords, ingredient_parts, ingredient_quantities,
    instructions, total_time, cook_time, prep_time,
    calories, protein, fat, sugar
"""


# Get recipes for calibration
def get_calibration_recipes(cursor, user_id: str, allergies: list[str] | None = None, swipes_done: int = 0):
    allergies = allergies or []

    excluded_ids = set(get_excluded_recipe_ids(cursor, allergies))

    cursor.execute("""SELECT recipe_id FROM user_swipes WHERE user_id = %s;""", (user_id,))

    swiped_ids = {row["recipe_id"] for row in cursor.fetchall()}

    cursor.execute("""SELECT MIN(recipe_id) AS min_id, MAX(recipe_id) AS max_id FROM food_recipes;""")

    bounds = cursor.fetchone()

    if not bounds or bounds["min_id"] is None:
        return {"recipes": []}

    min_id = bounds["min_id"]
    max_id = bounds["max_id"]

    needed = max(0, 20 - swipes_done)

    recipes = []
    fetched_ids = set(swiped_ids)

    max_attempts = 15
    attempts = 0

    while len(recipes) < needed and attempts < max_attempts:
        attempts += 1

        random_ids = random.sample(range(min_id, max_id + 1), min(50, max_id - min_id + 1))

        valid_ids = [recipe_id for recipe_id in random_ids if recipe_id not in excluded_ids and recipe_id not in fetched_ids]

        if not valid_ids:
            continue

        fetched_ids.update(valid_ids)

        remaining = needed - len(recipes)

        cursor.execute(f"""SELECT {RECIPE_FIELDS} FROM food_recipes WHERE recipe_id = ANY(%s) LIMIT %s;""", (valid_ids, remaining))

        recipes.extend(cursor.fetchall())

    return {"recipes": format_recipes(recipes)}


# Build personalized or calibration feed
def build_recipe_feed(user_id: str):
    conn = get_db_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:

            # Get user profile
            cursor.execute("""SELECT is_calibrated, profile_vector, allergies FROM users WHERE user_id = %s;""", (user_id,))

            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            is_calibrated = bool(user["is_calibrated"])
            user_vector = user["profile_vector"] or {}
            allergies = user["allergies"] or []

            # Calibration mode
            if not is_calibrated:
                cursor.execute("""SELECT COUNT(*) AS total_swipes FROM (SELECT 1 FROM user_swipes
                        WHERE user_id = %s LIMIT 20) AS sub;""", (user_id,))

                swipes_done = cursor.fetchone()["total_swipes"]

                calibration = get_calibration_recipes(cursor=cursor, user_id=user_id, allergies=allergies, swipes_done=swipes_done)

                return {
                    "mode": "calibration",
                    "is_calibrated": False,
                    "calibration_progress": {
                        "current_swipes": swipes_done,
                        "total_required": 20
                    },
                    "recipes": calibration["recipes"]
                }

            # Calibrated user must have a profile
            if not user_vector:
                raise HTTPException(status_code=409, detail="User calibrated but profile vector is empty")

            # Get previously swiped recipes
            cursor.execute("""SELECT recipe_id FROM user_swipes WHERE user_id = %s;""", (user_id,))

            swiped_ids = [row["recipe_id"] for row in cursor.fetchall()]

            # Filter allergies
            excluded_recipe_ids = get_excluded_recipe_ids(cursor, allergies)

            # Get recommendations from ML Engine
            recommended_ids = get_top_recipes(user_vector=user_vector, swiped_ids=swiped_ids, excluded_recipe_ids=excluded_recipe_ids, limit=10)

            if not recommended_ids:
                return {
                    "mode": "personalized",
                    "is_calibrated": True,
                    "recipes": []
                }

            # Fetch recipe information
            cursor.execute(f"""SELECT {RECIPE_FIELDS} FROM food_recipes  WHERE recipe_id = ANY(%s);""", (recommended_ids,))

            recipes = cursor.fetchall()

            # Preserve ranking from ML Engine
            recipe_order = {recipe_id: index for index, recipe_id in enumerate(recommended_ids)}

            recipes.sort(key=lambda recipe: recipe_order.get(recipe["recipe_id"], len(recipe_order)))

            return {
                "mode": "personalized",
                "is_calibrated": True,
                "recipes": format_recipes(recipes)
            }

    finally:
        release_db_connection(conn)


# Feed endpoint
@router.get("/feed/{user_id}")
def feed_endpoint(user_id: str):
    return build_recipe_feed(user_id)
