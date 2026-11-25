import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import users, feed, fridge, swipes, favorites


app = FastAPI(
    title="ZjemTo API",
    version="8.0",
    description="Backend API for ZjemTo recipe recommendation system"
)

@app.middleware("http")
async def measure_request_time(request, call_next):
    start = time.perf_counter()

    response = await call_next(request)

    elapsed = time.perf_counter() - start

    print(
        f"[PERFORMANCE] {request.method} "
        f"{request.url.path}: {elapsed:.3f}s",
        flush=True
    )

    return response


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)


# API routers
app.include_router(users.router)
app.include_router(feed.router)
app.include_router(fridge.router)
app.include_router(swipes.router)
app.include_router(favorites.router)


@app.get("/")
def root():
    return {"status": "ok", "service": "ZjemTo API"}