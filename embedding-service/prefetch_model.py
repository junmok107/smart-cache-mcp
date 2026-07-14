import os

from sentence_transformers import CrossEncoder, SentenceTransformer

# Bakes the model weights into the image layer at build time so the
# container doesn't need network access (or a slow first request) at runtime.
model_name = os.environ.get("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base")
rerank_model_name = os.environ.get("RERANK_MODEL_NAME", "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1")
SentenceTransformer(model_name, device="cpu")
CrossEncoder(rerank_model_name, device="cpu")
