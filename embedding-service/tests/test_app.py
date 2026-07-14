from fastapi.testclient import TestClient

from app import app


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    return dot / (norm_a * norm_b)


def test_health():
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


def test_embed_returns_768_dimensions():
    with TestClient(app) as client:
        response = client.post("/embed", json={"texts": ["query: hello world"]})
        assert response.status_code == 200
        data = response.json()
        assert data["dimensions"] == 768
        assert len(data["embeddings"]) == 1
        assert len(data["embeddings"][0]) == 768


def test_embed_batches_multiple_texts_in_one_call():
    with TestClient(app) as client:
        response = client.post(
            "/embed", json={"texts": ["query: a", "passage: b", "passage: c"]}
        )
        assert response.status_code == 200
        assert len(response.json()["embeddings"]) == 3


def test_embed_semantic_similarity_beats_unrelated_text():
    # Regression check for the proposal's 0.90 similarity threshold design
    # (section 3.2): a related query/passage pair should score meaningfully
    # higher than an unrelated pair.
    with TestClient(app) as client:
        response = client.post(
            "/embed",
            json={
                "texts": [
                    "query: 서울 날씨 어때?",
                    "passage: 서울은 오늘 맑고 기온은 25도입니다.",
                    "passage: 파이썬으로 리스트를 정렬하는 방법",
                ]
            },
        )
        embeddings = response.json()["embeddings"]
        sim_related = cosine(embeddings[0], embeddings[1])
        sim_unrelated = cosine(embeddings[0], embeddings[2])
        assert sim_related > sim_unrelated
