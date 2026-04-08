import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, Type } from '@google/genai';
import { Octokit } from "octokit";

export const maxDuration = 300;

type ContextParam = {
  owner: string;
  repo: string;
  defaultBranch: string;
  files: string[];
  prompt: string;
  modelId: string;
}

// Helper: send an SSE event
function sendEvent(controller: ReadableStreamDefaultController, event: string, data: any) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const context = await req.json();
  const octokit = new Octokit({ auth: session.accessToken });
  const modelId = context.modelId || "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        sendEvent(controller, "status", { message: `Initializing ${modelId}...`, step: "init" });

        if (modelId.includes("gemini")) {
          await runGeminiAgent(context, octokit, controller);
        } else if (modelId.includes("claude")) {
          await runAnthropicAgent(context, octokit, controller);
        } else {
          sendEvent(controller, "error", { message: `Unsupported model: ${modelId}` });
        }
      } catch (error: any) {
        console.error("Agent error:", error);
        // Extract a clean error message instead of dumping raw JSON
        let friendlyMessage = "An unexpected error occurred.";
        if (error?.status === 429 || error?.error?.code === 429 || error?.message?.includes("429")) {
          friendlyMessage = `Rate limit exceeded for ${modelId}. Your API quota has been exhausted. Please wait or switch to a different model.`;
        } else if (error?.message) {
          // Try to extract just the readable part
          try {
            const parsed = JSON.parse(error.message);
            friendlyMessage = parsed?.error?.message?.split(".")[0] || error.message;
          } catch {
            friendlyMessage = error.message.length > 200 ? error.message.slice(0, 200) + "..." : error.message;
          }
        }
        sendEvent(controller, "error", { message: friendlyMessage });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// ANTHROPIC AGENT
// ──────────────────────────────────────────────────────────────────────
async function runAnthropicAgent(context: ContextParam, octokit: Octokit, controller: ReadableStreamDefaultController) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is missing from .env.local");

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });
  const { owner, repo, defaultBranch, files, prompt, modelId } = context;

  const readGithubFile = {
    name: "read_github_file",
    description: "Read the contents of a specific file from the repository to inform your changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "The path to the file in the repository (e.g. 'src/app/page.tsx')" },
      },
      required: ["path"],
    },
  };

  const systemPrompt = `You are PR-Creator, an autonomous senior software engineer.
You are working on the repository: ${owner}/${repo} (Branch: ${defaultBranch}).
Here are the files in this repository:
${files.join('\n')}

Your goal is to complete the user's request:
<request>
${prompt}
</request>

If you need to explore code, use the read_github_file tool.
Once you understand the codebase and know what to change, provide the final output.
Your final output MUST be a JSON array of files to modify, structured exactly like this:
\`\`\`json
[
  {
    "path": "path/to/file.ts",
    "content": "the complete rewritten raw string content of the file"
  }
]
\`\`\`
DO NOT EXPLAIN. JUST OUTPUT THE JSON.`;

  let messages: any[] = [
    { role: "user", content: "Please begin. Read whichever files you need, then provide the JSON of modifications." }
  ];

  let finalResponse = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const MAX_ITERATIONS = 10;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const isLastIteration = i === MAX_ITERATIONS - 1;
    sendEvent(controller, "status", { message: `Thinking... (iteration ${i + 1}/${MAX_ITERATIONS})`, step: "thinking" });

    // On the last iteration, inject a strong forcing message
    if (isLastIteration) {
      messages.push({
        role: "user",
        content: "STOP exploring files. You MUST now output your final answer as a JSON array of file modifications. Output ONLY the JSON array, no explanations. Format: [{\"path\": \"...\", \"content\": \"...\"}]"
      });
      sendEvent(controller, "status", { message: "Forcing final JSON output...", step: "forcing" });
    }

    const completion = await anthropic.messages.create({
      model: modelId,
      max_tokens: 64000,
      system: systemPrompt,
      messages,
      // Drop tools on last iteration to force the agent to produce output
      tools: isLastIteration ? undefined : [readGithubFile as any],
    });

    totalInputTokens += completion.usage.input_tokens;
    totalOutputTokens += completion.usage.output_tokens;

    // Calculate live cost
    let liveCost = 0;
    if (modelId.includes('opus')) {
      liveCost = (totalInputTokens / 1_000_000) * 15.00 + (totalOutputTokens / 1_000_000) * 75.00;
    } else {
      liveCost = (totalInputTokens / 1_000_000) * 3.00 + (totalOutputTokens / 1_000_000) * 15.00;
    }

    sendEvent(controller, "usage", {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCostUsd: liveCost,
      provider: modelId,
    });

    messages.push({ role: "assistant", content: completion.content });

    const toolCalls = completion.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");

    if (toolCalls.length === 0) {
      sendEvent(controller, "status", { message: "Generating final modifications...", step: "finalizing" });
      const textBlock = completion.content.find((c): c is Anthropic.TextBlock => c.type === "text");
      finalResponse = textBlock?.text || "[]";
      break;
    }

    const toolResults = [];
    for (const toolCall of toolCalls) {
      if (toolCall.name === "read_github_file") {
        const filePath = (toolCall.input as { path: string }).path;
        sendEvent(controller, "tool", { action: "read_file", path: filePath });

        try {
          const { data } = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref: defaultBranch });
          let content = "";
          if (!Array.isArray(data) && data.type === "file" && data.content) {
            content = Buffer.from(data.content, "base64").toString("utf-8");
          }
          toolResults.push({ type: "tool_result", tool_use_id: toolCall.id, content: content.slice(0, 20000) });
          sendEvent(controller, "tool_done", { path: filePath, size: content.length });
        } catch (e: any) {
          toolResults.push({ type: "tool_result", tool_use_id: toolCall.id, content: `Error: ${e.message}` });
          sendEvent(controller, "tool_error", { path: filePath, error: e.message });
        }
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Parse and emit result
  await emitResult(controller, finalResponse, owner, repo, defaultBranch, octokit, modelId, totalInputTokens, totalOutputTokens);
}

// ──────────────────────────────────────────────────────────────────────
// GEMINI AGENT
// ──────────────────────────────────────────────────────────────────────
async function runGeminiAgent(context: ContextParam, octokit: Octokit, controller: ReadableStreamDefaultController) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) throw new Error("GEMINI_API_KEY is missing from .env.local");

  const ai = new GoogleGenAI({ apiKey: geminiApiKey });
  const { owner, repo, defaultBranch, files, prompt, modelId } = context;

  const systemPrompt = `You are PR-Creator, an autonomous senior software engineer.
You are working on the repository: ${owner}/${repo} (Branch: ${defaultBranch}).
Here are the files in this repository:
${files.join('\n')}

Your goal is to complete the user's request:
<request>
${prompt}
</request>

If you need to explore code, use the read_github_file tool.
Once you understand the codebase and know what to change, provide the final JSON output.
Your final output MUST be a JSON array of files to modify, structured exactly like this:
\`\`\`json
[
  {
    "path": "path/to/file.ts",
    "content": "the complete rewritten raw string content of the file"
  }
]
\`\`\`
DO NOT EXPLAIN. JUST OUTPUT THE JSON.`;

  const readGithubFileDecl = {
    name: 'read_github_file',
    description: 'Read the contents of a specific file from the repository to inform your changes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'The path to the file in the repository (e.g. src/app/page.tsx)' }
      },
      required: ['path']
    }
  };

  let contents: any[] = [{ role: 'user', parts: [{ text: "Please begin. Read whichever files you need, then provide the JSON of modifications." }] }];
  let finalResponseText = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const MAX_ITERATIONS = 10;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const isLastIteration = i === MAX_ITERATIONS - 1;
    sendEvent(controller, "status", { message: `Thinking... (iteration ${i + 1}/${MAX_ITERATIONS})`, step: "thinking" });

    const response = await ai.models.generateContent({
      model: modelId,
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: isLastIteration ? undefined : [{ functionDeclarations: [readGithubFileDecl as any] }],
      }
    });

    if (response.usageMetadata) {
      totalInputTokens += response.usageMetadata.promptTokenCount ?? 0;
      totalOutputTokens += response.usageMetadata.candidatesTokenCount ?? 0;
    }

    sendEvent(controller, "usage", {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCostUsd: 0,
      provider: modelId,
    });

    const candidate = response.candidates?.[0];
    if (!candidate || !candidate.content) break;

    contents.push(candidate.content);

    const functionCalls = candidate.content.parts?.filter(p => p.functionCall).map(p => p.functionCall);

    if (!functionCalls || functionCalls.length === 0) {
      sendEvent(controller, "status", { message: "Generating final modifications...", step: "finalizing" });
      finalResponseText = response.text || "[]";
      break;
    }

    const toolParts = [];
    for (const call of functionCalls) {
      if (call?.name === 'read_github_file') {
        const args = call.args as Record<string, any>;
        sendEvent(controller, "tool", { action: "read_file", path: args.path });

        try {
          const { data } = await octokit.rest.repos.getContent({ owner, repo, path: args.path, ref: defaultBranch });
          let content = "";
          if (!Array.isArray(data) && data.type === "file" && data.content) {
            content = Buffer.from(data.content, "base64").toString("utf-8");
          }
          toolParts.push({ functionResponse: { name: call.name, response: { content: content.slice(0, 30000) } } });
          sendEvent(controller, "tool_done", { path: args.path, size: content.length });
        } catch (e: any) {
          toolParts.push({ functionResponse: { name: call?.name, response: { error: e.message } } });
          sendEvent(controller, "tool_error", { path: args.path, error: e.message });
        }
      }
    }

    contents.push({ role: 'user', parts: toolParts });
  }

  await emitResult(controller, finalResponseText, owner, repo, defaultBranch, octokit, modelId, totalInputTokens, totalOutputTokens);
}

// ──────────────────────────────────────────────────────────────────────
// SHARED: Emit final result
// ──────────────────────────────────────────────────────────────────────
async function emitResult(
  controller: ReadableStreamDefaultController,
  rawResponse: string, owner: string, repo: string, defaultBranch: string,
  octokit: Octokit, modelId: string, totalInputTokens: number, totalOutputTokens: number
) {
  sendEvent(controller, "status", { message: "Parsing agent output...", step: "parsing" });

  const jsonMatch = rawResponse.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!jsonMatch) {
    const preview = rawResponse.slice(0, 300).replace(/\n/g, ' ');
    sendEvent(controller, "error", { message: `Agent did not return valid JSON modifications. The model said: "${preview}..."` });
    return;
  }

  const modificationsList = JSON.parse(jsonMatch[0]);

  sendEvent(controller, "status", { message: `Fetching original files for diff (${modificationsList.length} files)...`, step: "diffing" });

  const modifications = [];
  for (const mod of modificationsList) {
    let originalContent = "";
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: mod.path, ref: defaultBranch });
      if (!Array.isArray(data) && data.type === "file" && data.content) {
        originalContent = Buffer.from(data.content, "base64").toString("utf-8");
      }
    } catch (e: any) { /* new file */ }

    modifications.push({ path: mod.path, originalContent, content: mod.content });
  }

  let estimatedCostUsd = 0;
  if (modelId.includes('opus')) {
    estimatedCostUsd = (totalInputTokens / 1_000_000) * 15.00 + (totalOutputTokens / 1_000_000) * 75.00;
  } else if (modelId.includes('gemini')) {
    estimatedCostUsd = 0;
  } else {
    estimatedCostUsd = (totalInputTokens / 1_000_000) * 3.00 + (totalOutputTokens / 1_000_000) * 15.00;
  }

  sendEvent(controller, "result", {
    modifications,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, estimatedCostUsd, provider: modelId },
  });
}
