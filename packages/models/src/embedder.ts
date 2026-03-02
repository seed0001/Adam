import { type AdamError, type Result, ok, err, adamError } from "@adam/shared";

type EmbedderBackend = "transformers" | "openai-compatible";

/**
 * Embedding generator. Uses HuggingFace Transformers.js by default
 * for zero-cost, fully local, zero-API-dependency embeddings.
 *
 * This is what powers Adam's semantic memory search.
 * No API key required unless explicitly switching to a cloud backend.
 */
export class TransformersEmbedder {
  private pipeline: ((text: string) => Promise<number[]>) | null = null;
  private modelId: string;

  constructor(
    private backend: EmbedderBackend = "transformers",
    modelId?: string,
  ) {
    this.modelId = modelId ?? "Xenova/all-MiniLM-L6-v2";
  }

  async initialize(): Promise<Result<void, AdamError>> {
    if (this.backend !== "transformers") return ok(undefined);

    try {
      const { pipeline } = await import("@huggingface/transformers");

      const featureExtractor = await pipeline("feature-extraction", this.modelId, {
        dtype: "fp32",
      });

      this.pipeline = async (text: string) => {
        const output = await featureExtractor(text, { pooling: "mean", normalize: true });
        return Array.from(output.data as Float32Array);
      };

      return ok(undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(adamError("embedder:init-failed", `Failed to initialize embedder: ${msg}`, e));
    }
  }

  async embed(text: string): Promise<Result<number[], AdamError>> {
    if (!this.pipeline) {
      const init = await this.initialize();
      if (init.isErr()) return err(init.error);
    }

    if (!this.pipeline) {
      return err(adamError("embedder:not-initialized", "Embedder pipeline not initialized"));
    }

    try {
      const vector = await this.pipeline(text);
      return ok(vector);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(adamError("embedder:embed-failed", msg, e));
    }
  }

  async embedBatch(texts: string[]): Promise<Result<number[][], AdamError>> {
    const results: number[][] = [];
    for (const text of texts) {
      const result = await this.embed(text);
      if (result.isErr()) return err(result.error);
      results.push(result.value);
    }
    return ok(results);
  }

  vectorToBuffer(vector: number[]): Buffer {
    const buf = Buffer.allocUnsafe(vector.length * 4);
    for (let i = 0; i < vector.length; i++) {
      buf.writeFloatLE(vector[i] ?? 0, i * 4);
    }
    return buf;
  }

  bufferToVector(buf: Buffer): number[] {
    const count = buf.length / 4;
    const vector: number[] = [];
    for (let i = 0; i < count; i++) {
      vector.push(buf.readFloatLE(i * 4));
    }
    return vector;
  }
}
