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

class RecommendedRecipe(BaseModel):
    recipe_id: int
    cosine_similarity: float


class RecommendResponse(BaseModel):
    recommended_recipe_ids: list[int]
    recommended_recipes: list[RecommendedRecipe]


@app.post("/api/recommend", response_model=RecommendResponse)
async def recommend(req: RecommendRequest):
    if not req.user_vector:
        return RecommendResponse(
            recommended_recipe_ids=[],
            recommended_recipes=[]
        )

    X_tfidf = ml_state["X_tfidf"]
    n_recipes = ml_state["n_recipes"]
    expected_dim = ml_state["n_features"]

    user_vec = np.zeros(expected_dim, dtype=np.float32)

    for k, v in req.user_vector.items():
        idx = int(k)
        if 0 <= idx < expected_dim:
            user_vec[idx] = float(v)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Index {idx} is out of bounds for matrix dimension ({expected_dim})",
            )

    user_norm = np.linalg.norm(user_vec)

    if user_norm == 0:
        return RecommendResponse(
            recommended_recipe_ids=[],
            recommended_recipes=[]
        )

    user_vec /= user_norm

    banned_ids = set(req.swiped_ids) | set(req.excluded_recipe_ids)
    n_candidates = min(n_recipes, req.limit + len(banned_ids) + 50)

    scores = np.asarray(
        X_tfidf @ user_vec
    ).ravel()

    partition_idx = n_recipes - n_candidates

    top_indices = np.argpartition(
        scores,
        partition_idx
    )[partition_idx:]

    top_indices = top_indices[
        np.argsort(scores[top_indices])[::-1]
    ]

    recommended_recipes = []

    for idx in top_indices:
        recipe_id = int(idx)

        if recipe_id in banned_ids:
            continue

        similarity = float(
            np.clip(scores[idx], -1.0, 1.0)
        )

        recommended_recipes.append(
            RecommendedRecipe(
                recipe_id=recipe_id,
                cosine_similarity=similarity
            )
        )

        if len(recommended_recipes) >= req.limit:
            break

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