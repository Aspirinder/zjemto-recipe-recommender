from fastapi import APIRouter, HTTPException
from psycopg2.extras import RealDictCursor

from database import get_db_connection, release_db_connection
from schemas import FridgeRequest
from services.ml import get_top_recipes
from services.recipes import format_recipes


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
            cursor.execute("""
                SELECT base_group_id AS group_id, canonical_name
                FROM ingredient_base_groups
                ORDER BY canonical_name, base_group_id;
            """)

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
            cursor.execute("""
                SELECT is_calibrated, profile_vector, allergies
                FROM users
                WHERE user_id = %s;
            """, (user_id,))

            user = cursor.fetchone()

            if not user:
                raise HTTPException(
                    status_code=404,
                    detail="User not found"
                )

            user_vector = user["profile_vector"] or {}
            allergies = user["allergies"] or []

            if not user["is_calibrated"] or not user_vector:
                raise HTTPException(
                    status_code=409,
                    detail="Complete calibration before using fridge recommendations"
                )

            # Validate selected ingredient groups
            cursor.execute("""
                SELECT base_group_id AS group_id
                FROM ingredient_base_groups
                WHERE base_group_id = ANY(%s::integer[]);
            """, (group_ids,))

            valid_ids = {
                row["group_id"] for row in cursor.fetchall()
            }

            unknown_ids = sorted(set(group_ids) - valid_ids)

            if unknown_ids:
                raise HTTPException(
                    status_code=422,
                    detail={"unknown_group_ids": unknown_ids}
                )

            # Find recipes matching the fridge
            candidates = find_fridge_candidates(
                cursor=cursor,
                group_ids=group_ids,
                max_missing=data.max_missing,
                allergies=allergies
            )

            print(
                f"[FRIDGE] Selected groups: {len(group_ids)} | "
                f"Max missing: {data.max_missing} | "
                f"Candidates: {len(candidates)}",
                flush=True
            )

            if not candidates:
                return {"mode": "fridge", "recipes": []}

            whitelist_ids = [
                row["recipe_id"] for row in candidates
            ]

            # Rank candidates using ML Engine
            recommended_ids = get_top_recipes(
                user_vector=user_vector,
                swiped_ids=[],
                excluded_recipe_ids=[],
                whitelist_recipe_ids=whitelist_ids,
                limit=data.limit,
                status="fridge"
            )

            if not recommended_ids:
                return {"mode": "fridge", "recipes": []}

            # Accept only IDs from the SQL whitelist
            allowed_ids = set(whitelist_ids)

            recommended_ids = list(dict.fromkeys(
                recipe_id
                for recipe_id in recommended_ids
                if recipe_id in allowed_ids
            ))[:data.limit]

            if not recommended_ids:
                return {"mode": "fridge", "recipes": []}

            # Load recipe details
            cursor.execute(f"""
                SELECT {RECIPE_FIELDS}
                FROM food_recipes
                WHERE recipe_id = ANY(%s::integer[]);
            """, (recommended_ids,))

            recipes = cursor.fetchall()

            # Preserve ML ranking
            recipe_order = {
                recipe_id: index
                for index, recipe_id in enumerate(recommended_ids)
            }

            recipes.sort(
                key=lambda recipe: recipe_order[recipe["recipe_id"]]
            )

            # Attach information about missing ingredients
            candidate_info = {
                row["recipe_id"]: row
                for row in candidates
            }

            for recipe in recipes:
                info = candidate_info[recipe["recipe_id"]]

                recipe["missing_count"] = info["missing_count"]
                recipe["total_required"] = info["total_count"]

            return {
                "mode": "fridge",
                "recipes": format_recipes(recipes)
            }

    finally:
        release_db_connection(conn)


def find_fridge_candidates(
    cursor,
    group_ids: list[int],
    max_missing: int,
    allergies: list[str]
):
    # Increase memory for sorting and aggregation
    cursor.execute("SET LOCAL work_mem = '32MB';")

    cursor.execute("""
        WITH matched_requirements AS (
            SELECT
                recipe_id,
                ingredient_position
            FROM fridge_requirement_options
            WHERE group_id = ANY(%s::integer[])
            GROUP BY recipe_id, ingredient_position
            HAVING COUNT(DISTINCT clause_no) = MAX(clause_count)
        ),

        matched_recipes AS (
            SELECT
                recipe_id,
                COUNT(*) AS available_count
            FROM matched_requirements
            GROUP BY recipe_id
        ),

        recipe_match AS (
            SELECT
                stats.recipe_id,
                stats.total_required AS total_count,
                stats.total_required
                    - COALESCE(matched.available_count, 0)
                    AS missing_count
            FROM fridge_recipe_stats stats
            LEFT JOIN matched_recipes matched
                ON matched.recipe_id = stats.recipe_id
        )

        SELECT
            rm.recipe_id,
            rm.missing_count,
            rm.total_count
        FROM recipe_match rm
        WHERE rm.missing_count <= %s
          AND NOT EXISTS (
              SELECT 1
              FROM recipe_allergens ra
              WHERE ra.recipe_id = rm.recipe_id
                AND ra.allergen_tag = ANY(%s::text[])
          )
        ORDER BY rm.missing_count, rm.recipe_id;

    """, (group_ids, max_missing, allergies))

    return cursor.fetchall()