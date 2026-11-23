
import os
import requests

from typing import Literal
from fastapi import HTTPException


ML_API_URL = os.getenv("ML_API_URL","https://zjemto-ml-engine-bfcqgfh4hvc6g2fa.norwayeast-01.azurewebsites.net/api/recommend")


def get_top_recipes(user_vector: dict, swiped_ids: list[int], excluded_recipe_ids: list[int], limit: int = 10, whitelist_recipe_ids: list[int] | None = None,
    status: Literal["feed", "fridge"] = "feed") -> list[int]:

    # Without a user profile, personalized recommendations are unavailable
    if not user_vector:
        return []

    # Empty whitelist means no fridge candidates
    if status == "fridge":
        if whitelist_recipe_ids is None:
            raise ValueError("whitelist_recipe_ids is required in fridge mode")

        if not whitelist_recipe_ids:
            return []

    # Prepare request for ML Engine
    send_data = {
        "user_vector": user_vector,
        "swiped_ids": swiped_ids,
        "excluded_recipe_ids": excluded_recipe_ids,
        "limit": limit,
        "status": status
    }

    if status == "fridge":
        send_data["whitelist_recipe_ids"] = whitelist_recipe_ids

    try:
        response = requests.post(
            ML_API_URL,
            json=send_data,
            timeout=45.0
        )

        response.raise_for_status()

        data = response.json()

        recommended_ids = data.get("recommended_recipe_ids",[])

        if not isinstance(recommended_ids, list):
            raise ValueError("Invalid ML response: expected a list")

        return recommended_ids

    except (requests.exceptions.RequestException, ValueError) as e:
        print(f"Error calling ML API: {e}")

        raise HTTPException(status_code=503, detail="Recommendation service unavailable")
