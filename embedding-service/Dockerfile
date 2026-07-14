FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ENV EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-base
ENV HF_HOME=/app/.cache/huggingface

# Bake model weights into the image (CPU-only download; runtime device is
# chosen separately via the EMBEDDING_DEVICE env var).
COPY prefetch_model.py .
RUN python prefetch_model.py

COPY app.py .

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
