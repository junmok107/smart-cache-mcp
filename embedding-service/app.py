import os
from contextlib import asynccontextmanager
from typing import Optional

import torch
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.environ.get("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base")
DEVICE = os.environ.get("EMBEDDING_DEVICE", "cpu")

model: Optional[SentenceTransformer] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    device = DEVICE if (DEVICE != "cuda" or torch.cuda.is_available()) else "cpu"
    print(f"[embedding-service] loading {MODEL_NAME} on {device} "
          f"(cuda available: {torch.cuda.is_available()})")
    model = SentenceTransformer(MODEL_NAME, device=device)
    yield


app = FastAPI(lifespan=lifespan)


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dimensions: int


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
