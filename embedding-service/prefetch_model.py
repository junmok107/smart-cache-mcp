import os

from sentence_transformers import SentenceTransformer

# Bakes the model weights into the image layer at build time so the
# container doesn't need network access (or a slow first request) at runtime.
model_name = os.environ.get("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base")
SentenceTransformer(model_name, device="cpu")
