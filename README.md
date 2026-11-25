# Project ZjemTo

**Team:** Z2 · Artificial Intelligence lab, Collegium Da Vinci, 2026/2027 · group L2


## What it does

ZjemTo helps users discover recipes based on their food preferences,
available ingredients and allergies.

The system learns individual preferences through like/dislike feedback
and generates personalized recipe recommendations.

The Smart Fridge feature finds recipes based on available ingredients,
allowing up to two missing ingredient requirements.

## AI technique

The system uses content-based filtering with TF-IDF and cosine similarity. 
This approach allows the system to represent recipes and user preferences as vectors 
and recommend relevant recipes without requiring feedback from other users.

## Results

The recommendation engine was evaluated on 150 user profiles using a dataset of 522,517 recipes and 1,401,982 reviews. Each algorithm generated 10 recommendations per user.

| Metric | Most Popular (Baseline) | Binary Jaccard | TF-IDF + Cosine |
|---|---:|---:|---:|
| Mean Cosine Similarity | 0.114 | 0.301 | **0.394** |
| Novelty | 10.36 | 19.20 | **19.27** |
| Intra-list Diversity | **0.937** | 0.755 | 0.620 |
| Catalog Coverage | 0.003% | 0.211% | **0.263%** |
| Median Latency | **0.01 ms** | 16.2 ms | 14.5 ms |
| P95 Latency | **0.03 ms** | 25.8 ms | 23.8 ms |

TF-IDF with cosine similarity achieved the highest user profile similarity, novelty and catalog coverage. The local recommendation algorithm also met the project performance target of generating Top-10 recommendations in less than one second.

## How to run

The application is available online and does not require local installation.
The frontend is hosted on GitHub Pages, while the backend and ML Engine
are deployed on Microsoft Azure.

**Live application:** https://mulatkasofi.github.io/zjemto/

**API documentation:** https://zjemto-api.azurewebsites.net/docs

To run the backend locally:

```bash
git clone https://github.com/Aspirinder/zjemto-recipe-recommender.git
cd zjemto-recipe-recommender/ZjemTo-API
pip install -r requirements.txt
python -m uvicorn main:app --port 8000
```

Requirements: Python 3.11, configured PostgreSQL database and a running ML recommendation engine with a precomputed TF-IDF matrix.

Recommendations are returned in JSON format and displayed through the web application.

## Team

- **Yahor Koval (31028)** — Project coordination, recommendation algorithms, TF-IDF, ML Engine, algorithm evaluation and cloud deployment of the recommendation service.
- **Anton Talmachou (31145)** — Data processing, PostgreSQL, Backend API, user preference learning, allergy filtering, Redis caching, Smart Fridge and database optimization.
- **Sofiya Krasouskaya (30999)** — Web application development, React and TypeScript, API integration, frontend deployment and project documentation.

## Documentation

Full documentation in Polish: `docs/dokumentacja.md`. Technical abstract: `docs/abstract_en.md`.

- [Backend API and System Architecture](ZjemTo-API/README.md)
- [Data Processing](data-in-DB/README.md)