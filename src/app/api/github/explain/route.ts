import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { Octokit } from "octokit";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { owner, repo, defaultBranch, files, description, modelId } = await req.json();
  const octokit = new Octokit({ auth: session.accessToken });

  // Try to read README for context
  let readmeContent = "";
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: "README.md", ref: defaultBranch });
    if (!Array.isArray(data) && data.type === "file" && data.content) {
      readmeContent = Buffer.from(data.content, "base64").toString("utf-8").slice(0, 8000);
    }
  } catch { /* no README */ }

  const prompt = `Analyze this GitHub repository and provide a concise explanation.

Repository: ${owner}/${repo}
Description: ${description || "No description"}
Default branch: ${defaultBranch}
Total files: ${files.length}

File structure:
${files.slice(0, 200).join('\n')}

${readmeContent ? `README (first 8000 chars):\n${readmeContent}` : 'No README found.'}

Please provide:
1. **What this project does** (1-2 sentences)
2. **Tech stack** (languages, frameworks, key dependencies)
3. **Architecture** (brief overview of how the code is organized)
4. **Key files** to look at for understanding the codebase

Keep your response under 300 words. Use markdown formatting.`;

  try {
    let explanation = "";

    if (modelId?.includes('gemini')) {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) return new Response(JSON.stringify({ error: "GEMINI_API_KEY missing" }), { status: 500 });

      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const result = await ai.models.generateContent({
        model: modelId,
        contents: prompt,
        config: { maxOutputTokens: 4096 },
      });
      explanation = result.text || "";
    } else {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY missing" }), { status: 500 });

      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const stream = anthropic.messages.stream({
        model: modelId || "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
      const completion = await stream.finalMessage();

      for (const block of completion.content) {
        if (block.type === "text") explanation += block.text;
      }
    }

    return new Response(JSON.stringify({ explanation }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Explain error:", error);
    return new Response(JSON.stringify({ error: error.message?.slice(0, 200) }), { status: 500 });
  }
}
