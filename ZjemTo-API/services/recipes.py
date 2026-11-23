
import json


def parse_recipe_list(value):
    if value is None or value == "":
        return []

    if isinstance(value, list):
        return value

    if not isinstance(value, str):
        return []

    try:
        result = json.loads(value)
        return result if isinstance(result, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def format_recipes(recipes):
    for recipe in recipes:
        for field in (
            "ingredient_parts",
            "ingredient_quantities",
            "instructions",
            "keywords"
        ):
            recipe[field] = parse_recipe_list(
                recipe.get(field)
            )

    return recipes
