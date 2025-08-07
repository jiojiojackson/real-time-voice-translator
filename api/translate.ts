import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from "@google/genai";

// IMPORTANT: Set the API_KEY in your Vercel project environment variables
const apiKey = process.env.API_KEY;

if (!apiKey) {
  // This will cause the function to return a 500 error.
  throw new Error("API_KEY environment variable not set in Vercel.");
}

const ai = new GoogleGenAI({ apiKey });

// Helper to stream Gemini response to Vercel response
async function streamToResponse(
    iterableStream: AsyncGenerator<{text: string}>,
    res: VercelResponse
) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Vercel specific header for streaming
    res.setHeader('X-Accel-Buffering', 'no');
    
    for await (const chunk of iterableStream) {
        if(chunk.text) {
            res.write(chunk.text);
        }
    }
    res.end();
}


export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { japaneseText } = req.body;

  if (!japaneseText) {
    return res.status(400).json({ error: 'japaneseText is required' });
  }

  try {
    const model = "gemini-2.5-flash";
  
    const prompt = `Translate the following Japanese text to simple, natural Chinese. Only provide the Chinese translation, with no extra commentary or explanations.

    Japanese text: "${japaneseText}"
    `;

    const result = await ai.models.generateContentStream({
        model: model,
        contents: prompt,
        config: {
            thinkingConfig: { thinkingBudget: 0 }
        }
    });

    // Stream the response back to the client
    await streamToResponse(result, res);

  } catch (error) {
    console.error('Error calling Gemini API:', error);
    res.status(500).json({ error: 'Failed to get translation from Gemini API.' });
  }
}
