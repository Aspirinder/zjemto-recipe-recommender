from contextlib import asynccontextmanager
from time import time
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from scipy.sparse import load_npz
from sklearn.preprocessing import normalize
import logging
import time
from pathlib import Path
from typing import Literal

ml_state = {}

logger = logging.getLogger("uvicorn.error")

@asynccontextmanager
async def lifespan(app: FastAPI):
    total_start = time.perf_counter()
    matrix_path = Path(__file__).resolve().parent / "X_tfidf.npz"

    try:
        logger.info(
            "ML STARTUP: Matrix path=%s, exists=%s",
            matrix_path,
            matrix_path.is_file()
        )

        if not matrix_path.is_file():
            raise FileNotFoundError(f"Matrix not found: {matrix_path}")

        logger.info(
            "ML STARTUP: Matrix file size: %.2f MB",
            matrix_path.stat().st_size / (1024 * 1024)
        )

        start = time.perf_counter()

        X_tfidf = load_npz(matrix_path)

        logger.info(
            "ML STARTUP: Matrix loaded in %.2f sec. Shape=%s, NNZ=%s",
            time.perf_counter() - start,
            X_tfidf.shape,
            X_tfidf.nnz
        )

        start = time.perf_counter()

        logger.info(
            "ML STARTUP: Model fitted in %.2f sec",
            time.perf_counter() - start
        )

        ml_state["X_tfidf"] = X_tfidf
        ml_state["n_recipes"] = X_tfidf.shape[0]
        ml_state["n_features"] = X_tfidf.shape[1]

        logger.info(
            "ML STARTUP COMPLETE in %.2f sec",
            time.perf_counter() - total_start
        )

        yield

    except Exception:
        logger.exception("ML STARTUP FAILED")
        raise

    finally:
        ml_state.clear()


app = FastAPI(title="ZjemTo ML Engine", lifespan=lifespan)



class RecommendRequest(BaseModel):
    user_vector: dict[str, float]
    swiped_ids: list[int] = []
    excluded_recipe_ids: list[int] = []
    limit: int = 10

    status: Literal["feed", "fridge"] = "feed"
    whitelist_recipe_ids: list[int] | None = None

class RecommendedRecipe(BaseModel):
    recipe_id: int
    cosine_similarity: float


class RecommendResponse(BaseModel):
    recommended_recipe_ids: list[int]
    recommended_recipes: list[RecommendedRecipe]


@app.post("/api/recommend", response_model=RecommendResponse)
def recommend(req: RecommendRequest):

    if req.status == "fridge" and req.whitelist_recipe_ids is None:
        raise HTTPException(
            status_code=400,
            detail="whitelist_recipe_ids is required in fridge mode"
        )

    if not req.user_vector or req.limit <= 0:
        return RecommendResponse(
            recommended_recipe_ids=[],
            recommended_recipes=[]
        )

    X_tfidf = ml_state["X_tfidf"]
    n_recipes = ml_state["n_recipes"]
    expected_dim = ml_state["n_features"]

    # Tworzenie wektora użytkownika
    user_vec = np.zeros(expected_dim, dtype=np.float32)

    for k, v in req.user_vector.items():

        try:
            idx = int(k)
            value = float(v)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid feature: {k}={v}"
            )

        if not 0 <= idx < expected_dim:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid feature index: {idx}"
            )

        if not np.isfinite(value):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid feature value: {value}"
            )

        user_vec[idx] = value

    # Normalizacja wektora użytkownika
    user_norm = np.linalg.norm(user_vec)

    if user_norm == 0 or not np.isfinite(user_norm):
        return RecommendResponse(
            recommended_recipe_ids=[],
            recommended_recipes=[]
        )

    user_vec /= user_norm

    # Identyfikatory wykluczonych przepisów
    banned_ids = set(req.swiped_ids) | set(req.excluded_recipe_ids)

    # Wybór przepisów w zależności od trybu
    if req.status == "fridge":

        candidate_ids = np.array(
            sorted(
                recipe_id
                for recipe_id in set(req.whitelist_recipe_ids)
                if 0 <= recipe_id < n_recipes
                and recipe_id not in banned_ids
            ),
            dtype=np.int64
        )

        # Obliczanie podobieństwa tylko dla dozwolonych przepisów
        scores = np.asarray(
            X_tfidf[candidate_ids] @ user_vec
        ).ravel()

    else:

        # Obliczanie podobieństwa dla całego katalogu
        scores = np.asarray(
            X_tfidf @ user_vec
        ).ravel()

        candidate_ids = np.arange(n_recipes, dtype=np.int64)

        # Usuwanie wykluczonych przepisów
        valid_mask = np.ones(n_recipes, dtype=bool)

        for recipe_id in banned_ids:
            if 0 <= recipe_id < n_recipes:
                valid_mask[recipe_id] = False

        candidate_ids = candidate_ids[valid_mask]
        scores = scores[valid_mask]

    # Brak dostępnych przepisów
    if len(candidate_ids) == 0:
        return RecommendResponse(
            recommended_recipe_ids=[],
            recommended_recipes=[]
        )

    # Wybór najlepszych kandydatów
    k = min(req.limit, len(candidate_ids))

    partition_idx = len(scores) - k

    top_indices = np.argpartition(
        scores,
        partition_idx
    )[partition_idx:]

    # Sortowanie według podobieństwa kosinusowego
    top_indices = top_indices[
        np.argsort(scores[top_indices])[::-1]
    ]

    # Przygotowanie odpowiedzi
    recommended_recipes = []

    for idx in top_indices:

        recommended_recipes.append(
            RecommendedRecipe(
                recipe_id=int(candidate_ids[idx]),
                cosine_similarity=float(
                    np.clip(scores[idx], -1.0, 1.0)
                )
            )
        )

    return RecommendResponse(
        recommended_recipe_ids=[
            recipe.recipe_id
            for recipe in recommended_recipes
        ],
        recommended_recipes=recommended_recipes
    )

@app.middleware("http")
async def log_recommend_response(request: Request, call_next):
    start = time.perf_counter()

    try:
        response = await call_next(request)
        duration = (time.perf_counter() - start) * 1000

        if request.url.path == "/api/recommend":
            logger.info(
                "RECOMMEND | HTTP %s | %.2f ms",
                response.status_code,
                duration
            )

        return response

    except Exception:
        duration = (time.perf_counter() - start) * 1000

        logger.exception(
            "RECOMMEND | HTTP 500 | %.2f ms",
            duration
        )
        raise

@app.get("/", status_code=200)
async def root():
    return {
        "status": "ok",
        "service": "ZjemTo ML Engine"
    }