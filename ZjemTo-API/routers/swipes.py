
import json

from fastapi import APIRouter, HTTPException
from psycopg2.extras import RealDictCursor

from database import get_db_connection, release_db_connection
from schemas import SwipeRequest


router = APIRouter(prefix="/api", tags=["Swipes"])


CALIBRATION_THRESHOLD = 20
DECAY_FACTOR = 0.9
MIN_VECTOR_WEIGHT = 0.01


@router.post("/swipe")
def record_swipe(swipe: SwipeRequest):
    conn = get_db_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:

            # Check if user exists
            cursor.execute("""SELECT user_id, is_calibrated FROM users WHERE user_id = %s FOR UPDATE;""", (swipe.user_id,))

            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            is_calibrated = bool(user["is_calibrated"])

            # Get recipe vector
            cursor.execute("""SELECT tfidf_vector FROM food_recipes WHERE recipe_id = %s;""", (swipe.recipe_id,))
            
            recipe = cursor.fetchone()
            
            if not recipe:
                raise HTTPException(status_code=404,detail="Recipe not found")

            # Save swipe
            cursor.execute("""INSERT INTO user_swipes (user_id, recipe_id, action)
                VALUES (%s, %s, %s) ON CONFLICT DO NOTHING RETURNING recipe_id;""", (
                swipe.user_id, swipe.recipe_id, swipe.action))

            inserted = cursor.fetchone()

            # Duplicate swipe: do not update profile
            if not inserted:
                return {"status": "already_recorded", "is_calibrated": is_calibrated}

            # Save liked recipes
            if swipe.action == "like":
                cursor.execute("""INSERT INTO user_favorites (user_id, recipe_id) VALUES (%s, %s)
                    ON CONFLICT DO NOTHING;""", (swipe.user_id, swipe.recipe_id))

            # Calibration progress
            if not is_calibrated:
                cursor.execute("""SELECT COUNT(*) AS total_swipes FROM (SELECT 1 FROM user_swipes
                        WHERE user_id = %s LIMIT %s) AS sub;""", (swipe.user_id, CALIBRATION_THRESHOLD))

                swipe_count = cursor.fetchone()["total_swipes"]

                if swipe_count >= CALIBRATION_THRESHOLD:
                    cursor.execute("""UPDATE users SET is_calibrated = TRUE WHERE user_id = %s;""", (swipe.user_id,))
                    is_calibrated = True

            # Get user profile
            cursor.execute("""SELECT profile_vector FROM users WHERE user_id = %s;""", (swipe.user_id,))

            user_profile = cursor.fetchone()

            recipe_vector = recipe["tfidf_vector"] or {}
            user_vector = user_profile["profile_vector"] or {}

            # Decay existing preferences
            for feature in user_vector:
                user_vector[feature] *= DECAY_FACTOR

            # Apply like/dislike
            for feature, weight in recipe_vector.items():
                current_weight = user_vector.get(feature, 0.0)

                if swipe.action == "like":
                    new_weight = current_weight + weight

                else:
                    penalty = weight * (0.125 if current_weight > 0.5 else 0.25)

                    new_weight = max(current_weight - penalty, -1.0)

                user_vector[feature] = new_weight

            # Remove insignificant features
            user_vector = {feature: round(weight, 4) for feature, weight in user_vector.items() if abs(weight) > MIN_VECTOR_WEIGHT}

            # Save updated user profile
            cursor.execute("""UPDATE users SET profile_vector = %s WHERE user_id = %s;""", (json.dumps(user_vector), swipe.user_id))

            conn.commit()

            return {
                "status": "success",
                "is_calibrated": is_calibrated
            }

    finally:
        release_db_connection(conn)
