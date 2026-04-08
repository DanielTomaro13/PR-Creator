# 🚀 PR-Creator: Autonomous AI Software Engineer

PR-Creator is a next-generation web application that acts as your autonomous AI software engineer. Simply connect your GitHub repository, provide an instruction (or select an open issue), and watch as the Claude 3.7 Agent autonomously fetches your files, writes the code, and generates a formatted Pull Request directly from your browser.

## ✨ Features

- **GitHub OAuth Integration**: Operates directly on your behalf.
- **Anthropic Agent Orchestration**: Uses Claude 3.7 Sonnet for powerful autonomous code reasoning.
- **Dynamic Diff Rendering**: Reviews proposed code changes line-by-line before writing to your repository.
- **One-Click PR Submission**: Forks (if needed) and commits changes to a new branch, opening a PR natively.
- **Premium Glassmorphism UI**: Beautiful, vibrant, dark-themed dashboard.

---

## 🛠️ How to Run Locally

### 1. Prerequisites
You will need Node.js (v18+) and npm installed on your machine.

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables
You must set up your local environment configuration to use the system. Create a file named `.env.local` in the root of the repository.

```bash
# Copy the example file
cp .env.example .env.local
```

Inside your new `.env.local`, fill out the following keys:

```env
# 1. Next Auth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_random_secret_string_here (Use `openssl rand -base64 32` to generate one)

# 2. GitHub OAuth Application Keys
GITHUB_ID=your_github_oauth_client_id
GITHUB_SECRET=your_github_oauth_client_secret

# 3. Anthropic API Key
ANTHROPIC_API_KEY=your_claude_api_key_from_anthropic
```

#### How to get your GitHub OAuth Keys:
1. Go to your GitHub Profile -> Settings -> Developer Settings -> OAuth Apps.
2. Click **New OAuth App**.
3. **Application name**: PR-Creator (Local)
4. **Homepage URL**: `http://localhost:3000`
5. **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`
6. Click **Register application**.
7. Generate a new Client Secret. Copy the Client ID into `GITHUB_ID` and the secret into `GITHUB_SECRET` inside your `.env.local`.

### 4. Start the Development Server
```bash
npm run dev
```

### 5. Access the Platform
Open your browser and navigate to `http://localhost:3000`. 
Click **Connect GitHub to Start**, authenticate, and drop a repository URL in to begin!

---

## 🏗️ Architecture Stack

- **Frontend**: Next.js 15 (App Router), React, Lucide Icons
- **Styling**: Vanilla CSS with full Custom Property Design System
- **Authentication**: NextAuth.js (v4)
- **APIs**: Github REST API (Octokit), Anthropic SDK
- **Diff Engine**: diff, diff2html