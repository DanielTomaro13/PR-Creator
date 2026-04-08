import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

interface ProviderStatus {
  id: string;
  name: string;
  status: "available" | "rate_limited" | "no_credits" | "no_key" | "error";
  message: string;
}

export async function GET() {
  const results: ProviderStatus[] = [];

  // Check Anthropic
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    results.push({ id: "anthropic", name: "Anthropic (Claude)", status: "no_key", message: "No API key configured" });
  } else {
    try {
      const client = new Anthropic({ apiKey: anthropicKey });
      await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 5,
        messages: [{ role: "user", content: "hi" }],
      });
      results.push({ id: "anthropic", name: "Anthropic (Claude)", status: "available", message: "Credits available" });
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("credit balance is too low")) {
        results.push({ id: "anthropic", name: "Anthropic (Claude)", status: "no_credits", message: "No credits remaining" });
      } else if (msg.includes("rate_limit") || msg.includes("429")) {
        results.push({ id: "anthropic", name: "Anthropic (Claude)", status: "rate_limited", message: "Rate limited — try later" });
      } else {
        results.push({ id: "anthropic", name: "Anthropic (Claude)", status: "error", message: msg.slice(0, 100) });
      }
    }
  }

  // Check Gemini
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    results.push({ id: "gemini", name: "Google (Gemini)", status: "no_key", message: "No API key configured" });
  } else {
    // Try Gemini Pro
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "hi",
        config: { maxOutputTokens: 5 },
      });
      results.push({ id: "gemini", name: "Google (Gemini)", status: "available", message: "Quota available" });
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("429")) {
        results.push({ id: "gemini", name: "Google (Gemini)", status: "rate_limited", message: "Quota exhausted — resets daily" });
      } else {
        results.push({ id: "gemini", name: "Google (Gemini)", status: "error", message: msg.slice(0, 100) });
      }
    }
  }

  return NextResponse.json({ providers: results });
}
