const { GoogleGenAI } = require("@google/genai");

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Helper to generate embedding
const generateEmbedding = async (text) => {
    try {
        if (!text || !text.trim()) return null;
        
        const result = await ai.models.embedContent({
            model: "text-embedding-004",
            contents: [text],
        });

        const embedding =
            (Array.isArray(result?.embeddings) ? result.embeddings[0] : null) ??
            result?.embedding ??
            null;
        const values = embedding?.values;
        return Array.isArray(values) ? values : null;
    } catch (error) {
        console.error("Embedding generation failed:", error);
        return null;
    }
};

module.exports = {
    ai,
    generateEmbedding
};
