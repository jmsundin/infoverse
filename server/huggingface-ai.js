const { HfInference } = require("@huggingface/inference");

// Ensure environment variables are loaded if not already
if (!process.env.HF_API_KEY && !process.env.GEMINI_API_KEY) {
    require('dotenv').config();
}

const apiKey = process.env.HF_API_KEY ? process.env.HF_API_KEY.trim() : undefined;

if (!apiKey) {
    console.warn("Warning: HF_API_KEY is missing or empty.");
} else if (!apiKey.startsWith("hf_")) {
    console.warn("Warning: HF_API_KEY does not start with 'hf_'. This may cause routing errors.");
}

// Initialize Hugging Face
const hf = new HfInference(apiKey);

module.exports = {
    hf
};
