const express = require('express');
const router = express.Router();
const rateLimiter = require('./rateLimiter');
const { hf } = require('./huggingface-ai');

// Use a capable model available on Inference API (Serverless)
// Using Llama 3 8B as it is reliable on the free tier.
// Ideally user can configure this.
const MODEL = "meta-llama/Meta-Llama-3-8B-Instruct";

router.use(rateLimiter);

// Chat Endpoint
router.post('/chat', async (req, res) => {
    const { history, newMessage } = req.body;
    
    if (!newMessage) {
        return res.status(400).json({ message: 'Message is required' });
    }

    try {
        const messages = [];
        if (history) {
            history.forEach(h => {
                messages.push({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text });
            });
        }
        
        // Append newMessage only if it's not already the last message
        const lastMsg = messages[messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== newMessage) {
            messages.push({ role: 'user', content: newMessage });
        }
        
        const systemMessage = {
             role: 'system',
             content: "You are a helpful assistant in a knowledge graph application. Users use you to explore Wikidata and Wikipedia information. Keep answers concise and relevant."
        };
        
        const stream = await hf.chatCompletionStream({
            model: MODEL,
            messages: [systemMessage, ...messages],
            max_tokens: 1000,
            temperature: 0.7
        });

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                res.write(JSON.stringify({ text: content }) + '\n');
            }
        }
        res.end();

    } catch (error) {
        console.error("HF Chat Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ message: "Error connecting to Hugging Face." });
        } else {
            res.end();
        }
    }
});

// Generate Title Endpoint
router.post('/title', async (req, res) => {
    const { userMessage, modelResponse } = req.body;
    
    try {
        const prompt = `
          Based on the following conversation start, generate a very short, concise title (max 3-5 words) for this chat session. 
          Do not use quotes. Return ONLY the title.
          
          User: ${userMessage}
          Model: ${modelResponse}
          
          Title:
        `;
        
        const response = await hf.chatCompletion({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 50
        });

        const title = response.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '') || "New Chat";
        res.json({ title });
    } catch (e) {
        console.error("Title generation failed", e);
        res.json({ title: "New Chat" });
    }
});

// Helper to clean JSON string
const cleanJson = (text) => {
    if (!text) return "";
    // Remove markdown code blocks if present
    let cleaned = text.replace(/```json\n?|\n?```/g, "");
    // Try to find the first { and last }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    return cleaned;
};

// Expand Topic Endpoint
router.post('/expand', async (req, res) => {
    const { topic, existingContext } = req.body;
    
    if (!topic) return res.status(400).json({ message: 'Topic required' });

    try {
        const isLongText = topic.length > 100;
        const contextPrompt = existingContext && existingContext.length > 0 
            ? `\nConsider these existing topics in the graph: ${JSON.stringify(existingContext.slice(0, 50))}. If the generated topics are strongly related to any of them, include edges connecting to them (use the exact name from the list as targetName).`
            : '';

        const basePrompt = isLongText 
          ? `
            Analyze the following text: "${topic}".
            ${contextPrompt}
            Using your knowledge of the text content and general knowledge:
            1. Extract a concise Main Topic Title (max 5 words) that represents this text.
            2. Identify 3 to 5 key sub-concepts, entities, or related topics mentioned in or relevant to the text.
            3. Define the relationship from the Main Topic to these entities.
            4. Provide a short description and a likely English Wikipedia URL for each sub-concept.
          `
          : `
            Analyze the topic: "${topic}".
            ${contextPrompt}
            Using your knowledge of Wikidata properties and Wikipedia hierarchies:
            1. Identify 3 to 5 related entities or sub-concepts.
            2. Define the specific hierarchical relationship from "${topic}" to these new entities.
            3. Provide a short description and a likely English Wikipedia URL for each.
          `;

        const prompt = `
          ${basePrompt}
          
          Return the result strictly as JSON with the following structure:
          {
            "mainTopic": "string (optional)",
            "nodes": [
              { "name": "string", "description": "string", "type": "concept" | "entity", "wikiLink": "string" }
            ],
            "edges": [
              { "targetName": "string", "relationship": "string" }
            ]
          }
          Do not include any explanation, only the JSON.
        `;

        const response = await hf.chatCompletion({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1500,
            temperature: 0.1,
            response_format: { type: "json" } // Some HF models support this, or we fallback to prompt engineering
        });

        const text = response.choices[0]?.message?.content;
        const cleanedText = cleanJson(text);
        
        if (!cleanedText) throw new Error("Empty response from HF");

        res.json(JSON.parse(cleanedText));

    } catch (error) {
        console.error("HF Expansion Error:", error);
        res.json({ nodes: [], edges: [] });
    }
});

// Relationships Endpoint
router.post('/relationships', async (req, res) => {
    const { sourceNode, targetNodes } = req.body;
    
    if (!sourceNode || !targetNodes) return res.status(400).json({ message: 'Source and target nodes required' });
    if (targetNodes.length === 0) return res.json([]);

    try {
        const targetsJson = targetNodes.map(n => ({ id: n.id, content: n.content }));
        const prompt = `
          Analyze the relationship between the Source Node and the list of Target Nodes.
          
          Source Node: "${sourceNode.content}"
          
          Target Nodes:
          ${JSON.stringify(targetsJson)}
          
          Identify if there are any strong, direct semantic relationships (e.g., "is a", "part of", "created by", "related to", "opposite of").
          Return a JSON object with a list of relationships found. Only include strong connections.
          
          Structure:
          {
            "relationships": [
              { "targetId": "string", "relationship": "string" }
            ]
          }
           Do not include any explanation, only the JSON.
        `;

        const response = await hf.chatCompletion({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1000,
            temperature: 0.1,
            response_format: { type: "json" }
        });

        const text = response.choices[0]?.message?.content;
        const cleanedText = cleanJson(text);
        
        if (!cleanedText) return res.json([]);
        
        const result = JSON.parse(cleanedText);
        res.json(result.relationships || []);

    } catch (error) {
        console.error("HF Relationship discovery failed", error);
        res.json([]);
    }
});

module.exports = router;

