from fastapi import APIRouter, HTTPException
from psycopg2.extras import RealDictCursor

from database import get_db_connection, release_db_connection
from schemas import FridgeRequest
from services.ml import get_top_recipes
from services.recipes import format_recipes
from services.allergens import get_excluded_recipe_ids


router = APIRouter(prefix="/api", tags=["Fridge"])

RECIPE_FIELDS = """
    recipe_id, name, image_url, description, category,
    keywords, ingredient_parts, ingredient_quantities,
    instructions, total_time, cook_time, prep_time,
    calories, protein, fat, sugar
"""


@router.get("/ingredients/groups")
def get_ingredient_groups():
    conn = get_db_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""SELECT group_id, canonical_name FROM ingredient_groups ORDER BY canonical_name, group_id;""")

            groups = cursor.fetchall()

            return {"groups": groups, "total": len(groups)}

    finally:
        release_db_connection(conn)

@router.post("/recipes/fridge/{user_id}")
def get_fridge_recipes(user_id: str, data: FridgeRequest):
    group_ids = sorted(set(data.group_ids))

    conn = get_db_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:

            # Get user profile
            cursor.execute("""SELECT is_calibrated, profile_vector, allergies FROM users WHERE user_id = %s;""", (user_id,))

            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            user_vector = user["profile_vector"] or {}
            allergies = user["allergies"] or []

            if not user["is_calibrated"] or not user_vector:
                raise HTTPException(status_code=409, detail="Complete calibration before using fridge recommendations")

            # Validate selected ingredient groups
            cursor.execute("""SELECT group_id FROM ingredient_groups WHERE group_id = ANY(%s::integer[]);""", (group_ids,))

            valid_ids = {row["group_id"] for row in cursor.fetchall()}

            unknown_ids = sorted(set(group_ids) - valid_ids)

            if unknown_ids:
                raise HTTPException(status_code=422, detail={"unknown_group_ids": unknown_ids})

            # Find recipes matching the fridge
            candidates = find_fridge_candidates(cursor=cursor, user_id=user_id, group_ids=group_ids, allergies=allergies, max_missing=data.max_missing,
                candidate_limit=500)

            if not candidates:
                return {"mode": "fridge", "recipes": []}

            whitelist_ids = [row["recipe_id"] for row in candidates]

            # Rank candidates using ML Engine
            recommended_ids = get_top_recipes(user_vector=user_vector, swiped_ids=[], excluded_recipe_ids=[], whitelist_recipe_ids=whitelist_ids,
                limit=data.limit, status="fridge")

            if not recommended_ids:
                return {"mode": "fridge", "recipes": []}

            # Accept only IDs from the SQL whitelist

            allowed_ids = set(whitelist_ids)

            recommended_ids = list(dict.fromkeys(recipe_id for recipe_id in recommended_ids if recipe_id in allowed_ids))[:data.limit]

            # Load recipe details
            cursor.execute(f"""SELECT {RECIPE_FIELDS} FROM food_recipes WHERE recipe_id = ANY(%s::integer[]);""", (recommended_ids,))

            recipes = cursor.fetchall()

            # Preserve ML ranking
            recipe_order = {recipe_id: index for index, recipe_id in enumerate(recommended_ids)}

            recipes.sort(key=lambda recipe: recipe_order[ recipe["recipe_id"]])

            # Attach information about missing ingredients
            candidate_info = {row["recipe_id"]: row for row in candidates}

            for recipe in recipes:
                info = candidate_info[recipe["recipe_id"]]

                recipe["missing_count"] = info["missing_count"]
                recipe["total_required"] = info["total_count"]

            return {"mode": "fridge", "recipes": format_recipes(recipes)}

    finally:
        release_db_connection(conn)


def find_fridge_candidates(cursor, user_id: str, group_ids: list[int], allergies: list[str], max_missing: int, candidate_limit: int = 500):
    cursor.execute("""WITH recipe_match AS MATERIALIZED 
        (SELECT req.recipe_id, 
            COUNT(*) FILTER (WHERE NOT req.is_optional) AS total_count,
                COUNT(*) FILTER (WHERE NOT req.is_optional AND EXISTS (SELECT 1 FROM jsonb_array_elements(req.group_requirements) AS clause(options)
                        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(clause.options) AS candidate(group_id)
                            WHERE candidate.group_id::integer = ANY(%s::integer[])))) AS missing_count 
                            FROM recipe_ingredient_requirements req GROUP BY req.recipe_id) 
        SELECT rm.recipe_id, rm.missing_count, rm.total_count FROM recipe_match rm WHERE rm.total_count > 0 AND rm.missing_count <= %s
            AND NOT EXISTS (SELECT 1 FROM user_swipes sw WHERE sw.user_id = %s AND sw.recipe_id = rm.recipe_id) 
                AND NOT EXISTS (SELECT 1 FROM recipe_allergens ra WHERE ra.recipe_id = rm.recipe_id AND ra.allergen_tag = ANY(%s::text[]))
                    ORDER BY rm.missing_count, rm.recipe_id LIMIT %s;""", (group_ids, max_missing, user_id, allergies, candidate_limit))
    return cursor.fetchall()