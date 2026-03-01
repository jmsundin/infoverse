const { GoogleGenAI } = require("@google/genai");

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const EMBEDDING_DIMENSION = 768;
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";
const FALLBACK_EMBEDDING_MODELS = [
    DEFAULT_EMBEDDING_MODEL,
    "text-embedding-004",
];

// Helper to generate embedding
const generateEmbedding = async (text) => {
    try {
        if (!text || !text.trim()) return null;

        const configuredModel = process.env.GEMINI_EMBEDDING_MODEL?.trim();
        const candidateModels = configuredModel
            ? [configuredModel, ...FALLBACK_EMBEDDING_MODELS.filter((m) => m !== configuredModel)]
            : FALLBACK_EMBEDDING_MODELS;

        for (const model of candidateModels) {
            try {
                const result = await ai.models.embedContent({
                    model,
                    contents: [text],
                    config: {
                        outputDimensionality: EMBEDDING_DIMENSION,
                    },
                });

                const embedding =
                    (Array.isArray(result?.embeddings) ? result.embeddings[0] : null) ??
                    result?.embedding ??
                    null;
                const values = embedding?.values;

                if (Array.isArray(values) && values.length === EMBEDDING_DIMENSION) {
                    return values;
                }
            } catch (modelError) {
                const status = modelError?.status;
                const shouldTryNext = status === 404 || status === 400;
                if (!shouldTryNext) {
                    throw modelError;
                }
            }
        }

        throw new Error(`No embedding model returned a ${EMBEDDING_DIMENSION}-dimension vector.`);
    } catch (error) {
        console.error("Embedding generation failed:", error);
        return null;
    }
};

module.exports = {
    ai,
    generateEmbedding
};
