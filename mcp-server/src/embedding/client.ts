const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL ?? "http://localhost:8000";

// Raised whenever the embedding service can't be reached or fails, so cache
// logic can fall back to SHA-256 hash matching (proposal 8.2).
export class EmbeddingServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmbeddingServiceError";
  }
}

interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
}

async function embed(texts: string[]): Promise<number[][]> {
  let response: Response;
  try {
    response = await fetch(`${EMBEDDING_SERVICE_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
  } catch (error) {
    throw new EmbeddingServiceError("Failed to reach embedding service", { cause: error });
  }

  if (!response.ok) {
    throw new EmbeddingServiceError(`Embedding service responded with ${response.status}`);
  }

  const data = (await response.json()) as EmbedResponse;
  return data.embeddings;
}

// The "query:"/"passage:" prefix is applied here, by the caller, per the
// proposal's cached_call flow (section 3.4 Step 1) — embedding-service just
// embeds whatever text it's given.
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embed([`query: ${text}`]);
  return vector;
}

export async function embedPassage(text: string): Promise<number[]> {
  const [vector] = await embed([`passage: ${text}`]);
  return vector;
}
