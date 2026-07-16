import { GoogleGenAI } from "@google/genai";
import { SparePart } from "../types";

/**
 * Safely retrieves the Gemini API key.
 * Prioritizes keys configured by the user dynamically in localStorage,
 * falling back to build-time process.env.API_KEY configurations.
 */
export const isValidApiKey = (key: string | null | undefined): boolean => {
  if (!key) return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  
  const lowers = trimmed.toLowerCase();
  if (
    lowers === "undefined" ||
    lowers === "null" ||
    lowers === "missing_key" ||
    lowers === "aizasyyaml2orlgj_o9qeh02kekuw6la_pzlg4xm" || // Firebase key placeholder
    lowers.includes("youractualapikey") ||
    lowers.includes("apikeyhere")
  ) {
    return false;
  }
  return true;
};

export const getGeminiApiKey = (): string => {
  const localKey = localStorage.getItem('GEMINI_API_KEY');
  if (isValidApiKey(localKey)) {
    return localKey!.trim();
  }
  
  // Vite-defined environment variable fallback
  const processKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  if (isValidApiKey(processKey)) {
    return processKey.trim();
  }
  return "Missing_Key";
};

export const analyzeInventory = async (query: string, dataSample: SparePart[]): Promise<string> => {
  const currentKey = getGeminiApiKey();
  if (currentKey === "Missing_Key") {
    return "Gemini API Key is missing. Please configure GEMINI_API_KEY in your local storage settings or environment files.";
  }
  
  const ai = new GoogleGenAI({ apiKey: currentKey });

  // We limit the sample size to avoid token limits, prioritizing high value items
  const topItems = dataSample
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 50)
    .map(p => `- [${p.factoryId}] Code: ${p.materialNumber}, Part: ${p.partNumber}, Desc: ${p.description}, Qty: ${p.onHand}, Value: Rs. ${p.totalValue}, Machine: ${p.machine}`);

  const prompt = `
    You are an Inventory Optimization Expert for Tile Factories.
    User Query: "${query}"

    Here is a data sample of the top 50 highest-value non-moving spare parts (all considered dead stock) across our factories:
    ${topItems.join('\n')}

    Please analyze this data and answer the user's query. 
    If they ask for recommendations, suggest parts that could be shared between factories or consolidated.
    All currency values are in Sri Lankan Rupees (Rs).
    Be concise, professional, and data-driven.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });
    return response.text || "No analysis could be generated.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Sorry, I encountered an error while analyzing the inventory data.";
  }
};

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

/**
 * Feeds matching query context (drawn dynamically from the 11,903 parts catalog) 
 * and conversation history threads directly to Gemini to generate contextually 
 * rich replies about parts, machines, and locations.
 */
export interface ChatBotResponse {
  text: string;
  webSearchQueries?: string[];
  groundingSources?: Array<{ title: string; uri: string }>;
}

/**
 * Feeds matching query context (drawn dynamically from the 11,903 parts catalog) 
 * and conversation history threads directly to Gemini to generate contextually 
 * rich replies about parts, machines, and locations.
 */
export const askChatBot = async (
  query: string, 
  history: ChatMessage[], 
  relevantParts: SparePart[],
  systemSummaryText?: string
): Promise<ChatBotResponse> => {
  const currentKey = getGeminiApiKey();
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  try {
    const response = await fetch(`${API_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': currentKey
      },
      body: JSON.stringify({
        message: query,
        history,
        relevantParts,
        systemSummaryText
      })
    });

    // Try fallback endpoint /chat if /api/chat fails
    let resolvedResponse = response;
    if (!resolvedResponse.ok && resolvedResponse.status === 404) {
      resolvedResponse = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': currentKey
        },
        body: JSON.stringify({
          message: query,
          history,
          relevantParts,
          systemSummaryText
        })
      });
    }

    if (!resolvedResponse.ok) {
      const errText = await resolvedResponse.text();
      let parsedErr;
      try {
        parsedErr = JSON.parse(errText);
      } catch (e) {}
      throw new Error(parsedErr?.message || errText || `HTTP ${resolvedResponse.status}`);
    }

    const data = await resolvedResponse.json();
    return {
      text: data.text,
      webSearchQueries: data.webSearchQueries,
      groundingSources: data.groundingSources
    };
  } catch (error: any) {
    console.error("SpareBot Backend API Error:", error);
    return {
      text: `I had trouble connecting to my backend service. (Details: ${error.message || String(error)})`
    };
  }
};