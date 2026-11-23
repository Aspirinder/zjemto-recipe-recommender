
from fastapi import APIRouter, HTTPException
from psycopg2.extras import RealDictCursor

from database import get_db_connection, release_db_connection
from services.recipes import format_recipes


router = APIRouter(prefix="/api/users", tags=["Favorites"])


# Get user's liked recipes
@router.get("/{user_id}/liked-recipes")
def get_liked_recipes(user_id: str):
    conn = get_db_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:

            # Check if user exists
            cursor.execute("""SELECT 1 FROM users WHERE user_id = %s;""", (user_id,))

            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="User not found")

            # Get favorite recipes
            cursor.execute("""SELECT r.recipe_id, r.name, r.image_url, r.description, r.category, r.ingredient_parts,
                    r.ingredient_quantities, r.instructions, r.total_time, r.calories, r.protein, r.fat, r.keywords, r.cook_time, r.prep_time, r.sugar
                FROM user_favorites AS f JOIN food_recipes AS r ON r.recipe_id = f.recipe_id WHERE f.user_id = %s
                ORDER BY f.created_at DESC;""", (user_id,))

            recipes = cursor.fetchall()

            return {"recipes": format_recipes(recipes)}

    finally:
        release_db_connection(conn)


# Remove recipe from favorites
@router.delete("/{user_id}/liked-recipes/{recipe_id}")
def delete_liked_recipe(user_id: str, recipe_id: int):
    conn = get_db_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:

            # Check if user exists
            cursor.execute("""SELECT 1 FROM users WHERE user_id = %s;""", (user_id,))

            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="User not found")

            # Delete favorite
            cursor.execute("""DELETE FROM user_favorites WHERE user_id = %s AND recipe_id = %s RETURNING recipe_id;""", 
                (user_id, recipe_id))

            deleted = cursor.fetchone()

            if not deleted:
                raise HTTPException(status_code=404, detail="Recipe not found in favorites")

            conn.commit()

            return {"status": "success"}

    finally:
        release_db_connection(conn)
