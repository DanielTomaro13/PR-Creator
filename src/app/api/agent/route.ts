import { NextResponse } from "next/server";
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
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const context = await req.json();
    const octokit = new Octokit({ auth: session.accessToken });

    const provider = process.env.AI_PROVIDER?.toLowerCase() || "anthropic";

    let result;
    if (provider === "gemini") {
      result = await runGeminiAgent(context, octokit);
    } else {
      result = await runAnthropicAgent(context, octokit);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Agent error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ----------------------------------------------------------------------
// ANTHROPIC AGENT
// ----------------------------------------------------------------------
async function runAnthropicAgent(context: ContextParam, octokit: Octokit) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is missing");

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });
  const { owner, repo, defaultBranch, files, prompt } = context;

  const readGithubFile = {
    name: "read_github_file",
    description: "Read the contents of a specific file from the repository to inform your changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The path to the file in the repository (e.g. 'src/app/page.tsx')",
        },
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

  for (let i = 0; i < 6; i++) {
    const completion = await anthropic.messages.create({
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 8000,
      system: systemPrompt,
      messages,
      tools: [readGithubFile as any],
    });

    totalInputTokens += completion.usage.input_tokens;
    totalOutputTokens += completion.usage.output_tokens;

    messages.push({ role: "assistant", content: completion.content });

    const toolCalls = completion.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    
    if (toolCalls.length === 0) {
      const textBlock = completion.content.find((c): c is Anthropic.TextBlock => c.type === "text");
      finalResponse = textBlock?.text || "[]";
      break;
    }

    const toolResults = [];
    for (const toolCall of toolCalls) {
      if (toolCall.name === "read_github_file") {
        try {
          const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: (toolCall.input as { path: string }).path,
            ref: defaultBranch
          });
          let content = "";
          if (!Array.isArray(data) && data.type === "file" && data.content) {
            content = Buffer.from(data.content, "base64").toString("utf-8");
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: content.slice(0, 20000), // Cap size to avoid blowing context limit too quickly
          });
        } catch (e: any) {
           toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: `Error reading file: ${e.message}`,
          });
        }
      }
    }

    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  const jsonMatch = finalResponse.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!jsonMatch) throw new Error(`Agent did not return correctly formatted JSON diffs. Raw: ${finalResponse.slice(0, 100)}`);
  
  const modificationsList = JSON.parse(jsonMatch[0]);
  const modifications = await constructModifications(owner, repo, defaultBranch, modificationsList, octokit);

  // Claude 3.7 Sonnet pricing as of Mar 2025: $3.00 / M in, $15.00 / M out
  const estimatedCostUsd = (totalInputTokens / 1_000_000) * 3.00 + (totalOutputTokens / 1_000_000) * 15.00;

  return { modifications, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, estimatedCostUsd, provider: 'anthropic' } };
}

// ----------------------------------------------------------------------
// GEMINI AGENT
// ----------------------------------------------------------------------
async function runGeminiAgent(context: ContextParam, octokit: Octokit) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) throw new Error("GEMINI_API_KEY is missing");

  const ai = new GoogleGenAI({ apiKey: geminiApiKey });
  const { owner, repo, defaultBranch, files, prompt } = context;

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
              path: {
                  type: Type.STRING,
                  description: 'The path to the file in the repository (e.g. src/app/page.tsx)',
              }
          },
          required: ['path']
      }
  };

  let contents: any[] = [{ role: 'user', parts: [{ text: "Please begin. Read whichever files you need, then provide the JSON of modifications." }] }];
  let finalResponseText = '';
  
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < 6; i++) {
     const response = await ai.models.generateContent({
         model: 'gemini-2.5-pro',
         contents,
         config: {
             systemInstruction: systemPrompt,
             tools: [{ functionDeclarations: [readGithubFileDecl as any] }],
         }
     });

     if (response.usageMetadata) {
         totalInputTokens += response.usageMetadata.promptTokenCount ?? 0;
         totalOutputTokens += response.usageMetadata.candidatesTokenCount ?? 0;
     }

     const candidate = response.candidates?.[0];
     if (!candidate || !candidate.content) break;

     contents.push(candidate.content);

     const functionCalls = candidate.content.parts?.filter(p => p.functionCall).map(p => p.functionCall);
     
     if (!functionCalls || functionCalls.length === 0) {
         finalResponseText = response.text || "[]";
         break;
     }

     const toolParts = [];
     for (const call of functionCalls) {
        if (call?.name === 'read_github_file') {
             try {
                const args = call.args as Record<string, any>;
                 const { data } = await octokit.rest.repos.getContent({
                  owner,
                  repo,
                  path: args.path,
                  ref: defaultBranch
                });
                let content = "";
                if (!Array.isArray(data) && data.type === "file" && data.content) {
                  content = Buffer.from(data.content, "base64").toString("utf-8");
                }
                toolParts.push({ functionResponse: { name: call.name, response: { content: content.slice(0, 30000) } } });
             } catch(e: any) {
                 toolParts.push({ functionResponse: { name: call?.name, response: { error: e.message } } });
             }
        }
     }

     // Ensure we reply as the user providing tool results
     contents.push({ role: 'user', parts: toolParts });
  }

  const jsonMatch = finalResponseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!jsonMatch) throw new Error(`Gemini did not return correctly formatted JSON diffs. Raw: ${finalResponseText.slice(0, 100)}`);
  
  const modificationsList = JSON.parse(jsonMatch[0]);
  const modifications = await constructModifications(owner, repo, defaultBranch, modificationsList, octokit);

  // Gemini 2.5 Pro Free Tier pricing = $0.00
  const estimatedCostUsd = 0.0;

  return { modifications, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, estimatedCostUsd, provider: 'gemini' } };
}

// ----------------------------------------------------------------------
// SHARED UTILITIES
// ----------------------------------------------------------------------
async function constructModifications(owner: string, repo: string, defaultBranch: string, modificationsList: any[], octokit: Octokit) {
  const modifications = [];
  for (const mod of modificationsList) {
    let originalContent = "";
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: mod.path,
        ref: defaultBranch,
      });
      if (!Array.isArray(data) && data.type === "file" && data.content) {
        originalContent = Buffer.from(data.content, "base64").toString("utf-8");
      }
    } catch (e: any) {
       // File might be newly created by Claude/Gemini, so originalContent is empty
    }

    modifications.push({
      path: mod.path,
      originalContent,
      content: mod.content,
    });
  }
  return modifications;
}
