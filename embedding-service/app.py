import os
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
import torch
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import CrossEncoder, SentenceTransformer

MODEL_NAME = os.environ.get("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base")
RERANK_MODEL_NAME = os.environ.get("RERANK_MODEL_NAME", "BAAI/bge-reranker-v2-m3")
DEVICE = os.environ.get("EMBEDDING_DEVICE", "cpu")

model: Optional[SentenceTransformer] = None
reranker: Optional[CrossEncoder] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, reranker
    device = DEVICE if (DEVICE != "cuda" or torch.cuda.is_available()) else "cpu"
    print(f"[embedding-service] loading {MODEL_NAME} on {device} "
          f"(cuda available: {torch.cuda.is_available()})")
    model = SentenceTransformer(MODEL_NAME, device=device)
    print(f"[embedding-service] loading reranker {RERANK_MODEL_NAME} on {device}")
    reranker = CrossEncoder(RERANK_MODEL_NAME, device=device, max_length=512)
    yield


app = FastAPI(lifespan=lifespan)


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dimensions: int


class RerankRequest(BaseModel):
    query: str
    candidates: list[str]


class RerankResponse(BaseModel):
    scores: list[float]
    model: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    assert model is not None, "model not loaded yet"
    vectors = model.encode(request.texts, normalize_embeddings=True)
    return EmbedResponse(
        embeddings=vectors.tolist(),
        model=MODEL_NAME,
        dimensions=vectors.shape[1],
    )


@app.post("/rerank", response_model=RerankResponse)
def rerank(request: RerankRequest) -> RerankResponse:
    # Cross-encoder stage of retrieve-then-rerank: scores each (query,
    # candidate) pair jointly, which is far more discriminating than cosine
    # similarity between independently-encoded vectors (see CLAUDE.md
    # "reranking" section). Plain text, no e5 query:/passage: prefix — that
    # convention is specific to the bi-encoder, the cross-encoder has its own
    # tokenization and was never trained with it.
    assert reranker is not None, "reranker not loaded yet"
    if not request.candidates:
        return RerankResponse(scores=[], model=RERANK_MODEL_NAME)
    pairs = [[request.query, candidate] for candidate in request.candidates]
    raw_scores = reranker.predict(pairs)
    # This model's raw output is an unbounded logit, not a [0,1] probability
    # (unlike /embed's cosine similarity) — sigmoid makes it comparable to a
    # threshold the same way CACHE_SIMILARITY_THRESHOLD is.
    scores = 1 / (1 + np.exp(-raw_scores))
    return RerankResponse(scores=scores.tolist(), model=RERANK_MODEL_NAME)
