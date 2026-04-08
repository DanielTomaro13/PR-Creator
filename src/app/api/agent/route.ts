import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";
import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from "octokit";

export const maxDuration = 300; // Vercel edge/serverless max duration

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return NextResponse.json({ error: "Anthropic API key missing" }, { status: 500 });
    }

    const { owner, repo, defaultBranch, files, prompt } = await req.json();

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const octokit = new Octokit({ auth: session.accessToken });

    const readGithubFile = {
      name: "read_github_file",
      description: "Read the contents of a specific file from the repository to inform your changes.",
      input_schema: {
        type: "object",
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
      {
        role: "user",
        content: "Please begin. Read whichever files you need, then provide the JSON of modifications.",
      }
    ];

    let finalResponse = "";

    // Run the loop (max 5 tool iterations)
    for (let i = 0; i < 5; i++) {
      const completion = await anthropic.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 8000,
        system: systemPrompt,
        messages,
        tools: [readGithubFile as any],
      });

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
              content: content.slice(0, 15000), // Cap file size
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
    if (!jsonMatch) {
       return NextResponse.json({ error: "Agent did not return correctly formatted JSON diffs.", raw: finalResponse }, { status: 500 });
    }
    
    const modificationsList = JSON.parse(jsonMatch[0]);

    // Fetch original contents for the frontend to generate valid diffs
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
         // File might be newly created by Claude, so originalContent is empty
      }

      modifications.push({
        path: mod.path,
        originalContent,
        content: mod.content,
      });
    }

    return NextResponse.json({ modifications });
  } catch (error: any) {
    console.error("Agent error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
