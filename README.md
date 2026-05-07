# 📚 RAG — Production Deployment

> An AI-powered Retrieval-Augmented Generation (RAG) chatbot that answers questions from your own documents. Built with Go, Next.js, Python, Supabase, and Google Gemini — deployed on AWS EC2 via Docker containers and automated GitHub Actions CI/CD.

---

## 📋 Table of Contents

- [What This Project Does](#-what-this-project-does)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [How RAG Works](#-how-rag-works)
- [Local Development Setup](#-local-development-setup)
- [Data Ingestion](#-data-ingestion)
- [RAG Evaluation](#-rag-evaluation)
- [Docker — Running with Compose](#-docker--running-with-compose)
- [AWS + CI/CD Deployment](#-aws--cicd-deployment)
  - [Step 1: AWS IAM User](#step-1-aws-iam-user)
  - [Step 2: Amazon ECR Repositories](#step-2-amazon-ecr-repositories)
  - [Step 3: EC2 Instance](#step-3-ec2-instance)
  - [Step 4: Install Docker on EC2](#step-4-install-docker-on-ec2)
  - [Step 5: GitHub Self-Hosted Runner](#step-5-github-self-hosted-runner)
  - [Step 6: GitHub Secrets](#step-6-github-secrets)
  - [Step 7: Push & Deploy](#step-7-push--deploy)
- [Environment Variables](#-environment-variables)
- [API Reference](#-api-reference)
- [File Explanations](#-file-explanations)
- [Troubleshooting](#-troubleshooting)

---

## 🤖 What This Project Does

This application lets you upload any PDF document and ask natural-language questions about it. The AI answers **only from the document's content**, citing the exact pages it used — no hallucinations from general knowledge.

**Example use cases:**
- Ask questions about a textbook, research paper, or course notes
- Get cited, page-referenced answers from a legal or medical document
- Build a custom knowledge base for any subject

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        DEVELOPER                            │
│   git push origin main                                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              GITHUB ACTIONS — CI (ubuntu-latest)            │
│  1. Build backend Docker image  → push to Amazon ECR        │
│  2. Build frontend Docker image → push to Amazon ECR        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           GITHUB ACTIONS — CD (self-hosted on EC2)          │
│  1. Pull backend image from ECR                             │
│  2. Pull frontend image from ECR                            │
│  3. docker compose up -d                                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    AWS EC2 (Ubuntu 22.04)                   │
│                                                             │
│  ┌───────────────────┐    ┌──────────────────────────────┐  │
│  │  Frontend         │    │  Backend                     │  │
│  │  Next.js          │───▶│  Go HTTP Server :8081        │  │
│  │  port 3000        │    │  + Python Embed Server :8001 │  │
│  └───────────────────┘    └──────────┬───────────────────┘  │
└─────────────────────────────────────┼───────────────────────┘
                                      │
                    ┌─────────────────┼──────────────────┐
                    │                 │                   │
                    ▼                 ▼                   ▼
             ┌──────────┐    ┌──────────────┐    ┌──────────────┐
             │ Supabase │    │ Gemini API   │    │ Embed Model  │
             │ (Vector  │    │ (Answer      │    │ all-mpnet    │
             │  Search) │    │  Generation) │    │ (Local CPU)  │
             └──────────┘    └──────────────┘    └──────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | Next.js 16 + TypeScript | Chat UI with markdown rendering |
| **Backend API** | Go (Golang) | Fast HTTP server, orchestrates RAG pipeline |
| **Embedding** | Python + `sentence-transformers` (`all-mpnet-base-v2`) | Converts text to 768-dim vectors locally |
| **Vector Database** | Supabase (pgvector) | Stores and searches document embeddings |
| **LLM** | Google Gemini 2.5 Flash | Generates answers from retrieved context |
| **Ingestion** | Python (`PyMuPDF`, `tiktoken`) | Parses PDF → chunks → vectors → Supabase |
| **Containerization** | Docker + Docker Compose | Packages the whole app into portable containers |
| **Registry** | Amazon ECR | Stores Docker images in the cloud |
| **Hosting** | Amazon EC2 (t2.large) | Runs the containers in production |
| **CI/CD** | GitHub Actions | Automates build and deployment on every push |

---

## 📁 Project Structure

```
RAG_Production/
│
├── backend/                        # Go API server + Python embed server
│   ├── main.go                     # Go HTTP server — handles /chat and /health
│   ├── embed_server.py             # Python HTTP server — generates text embeddings
│   ├── Dockerfile                  # Multi-stage: builds Go binary + bakes AI model
│   ├── entrypoint.sh               # Boots embed server, then Go server
│   ├── .dockerignore               # Prevents .env leaking into image
│   ├── go.mod                      # Go module definition
│   └── go.sum                      # Go dependency lock file
│
├── frontend/                       # Next.js chat interface
│   ├── src/app/
│   │   ├── page.tsx                # Main chat UI component
│   │   ├── layout.tsx              # Root layout
│   │   └── globals.css             # Global styles
│   ├── Dockerfile                  # Multi-stage: builds standalone Next.js image
│   ├── .dockerignore               # Prevents node_modules bloating build context
│   ├── next.config.ts              # Next.js config (standalone output enabled)
│   └── package.json                # Node dependencies
│
├── .github/
│   └── workflows/
│       └── cicd.yaml               # CI/CD pipeline — build, push, deploy
│
├── injest.py                       # One-time script: PDF → embeddings → Supabase
├── human-nutrition-text.pdf        # Sample document (replace with your own)
├── docker-compose.yml              # Orchestrates backend + frontend containers
├── .env                            # Local secrets (never committed)
├── .env.example                    # Safe template — commit this, not .env
├── .gitignore                      # Protects secrets and build artifacts
└── README.md                       # This file
```

---

## 🔍 How RAG Works

RAG (Retrieval-Augmented Generation) answers questions using your specific documents rather than general training data.

```
User Question
     │
     ▼
[1] EMBED QUESTION
     Python embed server converts the question
     into a 768-dimensional vector (numerical representation)
     │
     ▼
[2] VECTOR SEARCH (Supabase / pgvector)
     Find the 5 most semantically similar chunks
     from the document using cosine similarity
     │
     ▼
[3] BUILD PROMPT
     Combine the retrieved chunks with the user's question:
     "Answer ONLY from this context: [chunks]... Question: ..."
     │
     ▼
[4] CALL GEMINI API
     Gemini 2.5 Flash reads the context + question
     and generates a cited, markdown-formatted answer
     │
     ▼
[5] RETURN RESPONSE
     Answer + source citations (page numbers) sent to frontend
```

---

## 🧠 Detailed Codebase Architecture Analysis

This section provides a deeper, multi-layered evaluation of the internal system design, module responsibilities, and data flow patterns.

### 1. System Flow & Data Modeling
The application employs a microservices-inspired architecture, coordinated by Docker Compose.
- **Frontend (Next.js):** Manages user interactions ephemerally. Uses React state for conversation history and markdown rendering for rich text formatting.
- **Backend Orchestrator (Go):** Acts as the central API gateway. It receives HTTP requests, delegates embedding generation to the Python service, orchestrates vector search in Supabase, and constructs strict contextual prompts for the LLM. 
- **Data Model:** Documents are parsed into chunks. Each chunk is stored in Supabase `pgvector` with:
  - `content`: Raw text of the chunk.
  - `embedding`: 768-dimensional float array.
  - `metadata`: JSON object containing source file name and page number for precise citations.

### 2. Module Responsibilities
- **`main.go`:** The core routing and business logic layer. Implements sequential API calls to coordinate the entire RAG pipeline from a single endpoint (`/chat`).
- **`embed_server.py`:** A dedicated, single-purpose ML worker. By isolating this from Go, the system leverages Python's superior Machine Learning ecosystem (`sentence-transformers`, `torch`) while keeping the main API layer in high-performance Go.
- **`injest.py`:** The ETL (Extract, Transform, Load) pipeline. Uses `PyMuPDF` for PDF extraction and robust text chunking algorithms to ensure optimal embedding quality.
- **`evaluate.py`:** A standalone Quality Assurance module utilizing the `Ragas` framework. It injects test queries and evaluates the system's output against standard metrics (Faithfulness, Answer Relevancy, Context Recall).

### 3. Design Decisions & Patterns
- **Threshold-Based Filtering:** The backend employs a strict `match_threshold` (0.70) during Supabase vector searches. This prevents "hallucinations by association" and allows the system to gracefully handle casual greetings or off-topic queries by bypassing the LLM entirely.
- **Stateless Architecture:** Both the Go backend and Python embed server are entirely stateless. Context is retrieved and assembled dynamically per request. This enables trivial horizontal scaling if deployed to a Kubernetes cluster.
- **Multi-Stage Containerization:** The Dockerfiles utilize multi-stage builds to compile Go and Next.js artifacts, discarding bulky build dependencies to create highly optimized, lightweight production images.

### 4. Scalability & Future Optimizations
- **Local Embedding Constraints:** The CPU-bound local embedding generation in `embed_server.py` is currently the primary computational bottleneck and could be moved to a GPU instance or scaled horizontally under heavy load.
- **Conversation History:** The system currently treats every query as an isolated event. Implementing session IDs and a `conversations` database table would enable multi-turn, context-aware chatting.
- **Response Streaming:** Implementing Server-Sent Events (SSE) or WebSockets from the Gemini API through the Go backend to the Next.js frontend would drastically improve perceived latency for the end user.

---

## 💻 Local Development Setup

### Prerequisites

- [Go 1.24+](https://go.dev/dl/)
- [Python 3.11+](https://www.python.org/downloads/)
- [Node.js 20+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd RAG_Production
```

### 2. Set up environment variables

```bash
# Copy the template
cp .env.example .env

# Edit .env and fill in your real values
# (see Environment Variables section below)
```

### 3. Set up Supabase

In your Supabase project, run this SQL to create the required table and function:

```sql
-- Enable pgvector extension
create extension if not exists vector;

-- Create the chunks table
create table chunks (
  id          bigserial primary key,
  doc_id      text,
  chunk_index integer,
  content     text,
  metadata    jsonb,
  embedding   vector(768)
);

-- Create the similarity search function
create or replace function match_documents(
  query_embedding vector(768),
  match_count     int,
  match_threshold float,
  filter          jsonb default '{}'
)
returns table (
  content    text,
  metadata   jsonb,
  similarity float
)
language plpgsql as $$
begin
  return query
  select
    chunks.content,
    chunks.metadata,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from chunks
  where 1 - (chunks.embedding <=> query_embedding) > match_threshold
  order by chunks.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

### 4. Run the backend locally

```bash
cd backend

# Install Go dependencies
go mod download

# Install Python dependencies for embed server
pip install sentence-transformers torch

# Terminal 1: Start embed server
python embed_server.py

# Terminal 2: Start Go server
go run main.go
```

### 5. Run the frontend locally

```bash
cd frontend
npm install
npm run dev
```

Visit **http://localhost:3000**

---

## 📥 Data Ingestion

Run this **once** to parse your PDF and upload embeddings to Supabase:

```bash
# Install ingestion dependencies (from project root)
pip install pymupdf tiktoken supabase sentence-transformers tqdm python-dotenv

# Place your PDF in the project root, then update injest.py:
# PDF_PATH = "your-document.pdf"
# DOC_ID   = "your-doc-id"

# Run ingestion
python injest.py
```

**What it does:**
1. Reads every page of the PDF
2. Cleans and splits text into overlapping sentence chunks (~20 sentences each)
3. Generates a 768-dim embedding vector for each chunk using the local `all-mpnet-base-v2` model
4. Uploads all chunks + embeddings to Supabase in batches of 200

> ⚠️ First run downloads ~400MB model. Subsequent runs are instant.

---

## 📊 RAG Evaluation

We use [Ragas](https://docs.ragas.io/) to evaluate the performance of our RAG pipeline quantitatively using Gemini as the judge. The evaluation script measures:
- **Faithfulness**: Factuality of the answer based on the retrieved context.
- **Answer Relevancy**: How well the generated answer addresses the user's question.
- **Context Precision**: Relevance and ranking of the retrieved document snippets.
- **Context Recall**: Whether the retrieved snippets successfully capture the required information.

### Running Evaluation

1. **Ensure your Go backend is running** (either locally or on AWS). The `evaluate.py` script makes real HTTP requests to the `/chat` endpoint.
2. **Install evaluation dependencies**:
   ```bash
   pip install -r evaluation/requirements.txt
   ```
3. **Run the evaluation**:
   ```bash
   python evaluation/evaluate.py
   ```

The script will evaluate the sample questions in `evaluation/test_set.json` and save detailed metrics to `evaluation/evaluation_results.csv`.

---

## 🐳 Docker — Running with Compose

Test the full production stack locally before deploying:

```bash
# From project root — build and start both containers
docker compose up --build

# Or run in background
docker compose up --build -d

# View logs
docker logs rag_backend
docker logs rag_frontend

# Stop everything
docker compose down
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8081 |
| Health Check | http://localhost:8081/health |

---

## ☁️ AWS + CI/CD Deployment

### Step 1: AWS IAM User

1. Go to **AWS Console → IAM → Users → Create User**
2. Name: `rag-cicd-user`
3. Attach these managed policies:
   - `AmazonEC2ContainerRegistryFullAccess`
   - `AmazonEC2FullAccess`
4. **Security Credentials → Create Access Key → Application running outside AWS**
5. Download the `.csv` — save `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

---

### Step 2: Amazon ECR Repositories

1. Go to **AWS Console → ECR → Create repository** (Private)
2. Create **one repository** named: `rag-production`
3. Choose your region (e.g., `us-east-1`)
4. Note the registry URI: `123456789012.dkr.ecr.us-east-1.amazonaws.com`

---

### Step 3: EC2 Instance

**Launch Settings:**

| Setting | Value |
|---|---|
| AMI | Ubuntu Server 22.04 LTS |
| Instance Type | `t2.large` (2 vCPU, 8 GB RAM) |
| Storage | 30 GB gp3 |

**Security Group — Required Inbound Rules:**

| Port | Protocol | Source | Purpose |
|---|---|---|---|
| 22 | TCP | Your IP | SSH access |
| 80 | TCP | 0.0.0.0/0 | HTTP |
| 443 | TCP | 0.0.0.0/0 | HTTPS |
| 3000 | TCP | 0.0.0.0/0 | Next.js frontend |
| 8081 | TCP | 0.0.0.0/0 | Go backend API |

---

### Step 4: Install Docker on EC2

```bash
# SSH into EC2
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>

# Install Docker
sudo apt-get update -y && sudo apt-get upgrade -y
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu
newgrp docker

# Install Docker Compose plugin
sudo apt-get install docker-compose-plugin -y

# Verify
docker --version
docker compose version
```

---

### Step 5: GitHub Self-Hosted Runner

This installs a GitHub Actions agent on your EC2 so the CD job can run there.

1. In your GitHub repo: **Settings → Actions → Runners → New self-hosted runner**
2. Select **Linux → x64**
3. Follow the commands shown in GitHub UI (they include a unique token):

```bash
mkdir actions-runner && cd actions-runner

# Download runner (use version shown in GitHub UI)
curl -o actions-runner-linux-x64-2.322.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.322.0/actions-runner-linux-x64-2.322.0.tar.gz

tar xzf ./actions-runner-linux-x64-2.322.0.tar.gz

# Configure (use YOUR repo URL and token from GitHub UI)
./config.sh --url https://github.com/YOUR_USERNAME/YOUR_REPO --token YOUR_TOKEN

# Install and start as a background service
sudo ./svc.sh install
sudo ./svc.sh start
```

4. Verify the runner shows as **Idle** in GitHub → Settings → Actions → Runners

---

### Step 6: GitHub Secrets

Go to: **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Where to Get It |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user CSV (Step 1) |
| `AWS_SECRET_ACCESS_KEY` | IAM user CSV (Step 1) |
| `AWS_DEFAULT_REGION` | e.g., `us-east-1` |
| `ECR_REPO` | `rag-production` (The name of your single ECR repo) |
| `EC2_PUBLIC_IP` | EC2 → Instance Summary → Public IPv4 address |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/) |
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |

---

### Step 7: Push & Deploy

```bash
git add .
git commit -m "feat: production deployment with Docker + CI/CD"
git push origin main
```

**GitHub Actions will automatically:**
1. Build both Docker images on GitHub's servers
2. Push them to ECR
3. SSH into your EC2 runner and deploy them

**Monitor progress:** GitHub → Actions tab

**Verify on EC2:**
```bash
docker container ls                         # See running containers
curl http://localhost:8081/health           # Should return {"status":"ok"}
```

**Access the app:** `http://<EC2_PUBLIC_IP>:3000`

---

## 🔐 Environment Variables

Copy `.env.example` to `.env` and fill in your values. Never commit `.env`.

```env
# Google Gemini API — https://aistudio.google.com/
GEMINI_API_KEY=your_gemini_api_key_here

# Supabase — Project Settings → API
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
```

---

## 📡 API Reference

### `POST /chat`

Send a question and receive an AI-generated answer with citations.

**Request:**
```json
{
  "query": "What is the role of protein in muscle synthesis?"
}
```

**Response:**
```json
{
  "reply": "## Protein and Muscle Synthesis\n\nProtein plays a critical role...",
  "citations": [
    {
      "text": "Dietary protein provides amino acids that are...",
      "page": 42,
      "source": "human-nutrition-text.pdf"
    }
  ]
}
```

## 📄 File Explanations

| File | Role |
|---|---|
| `backend/main.go` | Go HTTP server. Handles `/chat`: calls embed server → Supabase vector search → Gemini API → returns answer + citations. Handles `/health` for Docker. |
| `backend/embed_server.py` | Minimal Python HTTP server (port 8001). Converts text to 768-dim vectors using `all-mpnet-base-v2` model locally. |
| `backend/entrypoint.sh` | Docker container startup script. Starts Python server in background, waits 8s for model to load, then starts Go server in foreground. |
| `backend/Dockerfile` | Multi-stage build. Stage 1: compiles Go binary. Stage 2: Python runtime + pre-downloads AI model + copies Go binary. |
| `backend/.dockerignore` | Prevents `.env` file and Python cache from leaking into the Docker image. |
| `frontend/src/app/page.tsx` | React chat UI. Sends queries to backend, renders markdown responses, shows citation chips with source page numbers. |
| `frontend/next.config.ts` | Enables `output: "standalone"` so Next.js produces a minimal production bundle without full `node_modules`. |
| `frontend/Dockerfile` | 3-stage build: deps → build (with `NEXT_PUBLIC_API_URL` baked in) → minimal runner. |
| `frontend/.dockerignore` | Excludes `node_modules` and `.next` from Docker build context (saves ~500MB per build). |
| `docker-compose.yml` | Defines both services, their ports, env vars, healthcheck, and start order dependency. |
| `.github/workflows/cicd.yaml` | CI job builds + pushes images to ECR. CD job (on EC2) pulls images and starts containers. |
| `injest.py` | One-time ingestion script. Reads PDF → chunks → embeds → uploads to Supabase. |
| `.gitignore` | Protects `.env`, `node_modules`, build artifacts, Go binaries from being committed. |

---

## 🔧 Troubleshooting

| Problem | Cause | Solution |
|---|---|---|
| `runner offline` in GitHub Actions | EC2 runner service stopped | SSH into EC2 → `cd actions-runner && sudo ./svc.sh start` |
| Backend container exits immediately | Embed server crash or missing deps | `docker logs rag_backend` — check Python errors |
| `/health` returns connection refused | Go server not started yet | Wait 30s after container starts; embed model takes ~10s to load |
| Frontend shows "Error communicating with backend" | Wrong `NEXT_PUBLIC_API_URL` at build time | Rebuild frontend image with correct URL |
| ECR push fails — `no basic auth credentials` | ECR login expired | Re-run `aws ecr get-login-password` or check IAM policy |
| Port 3000/8081 unreachable from browser | EC2 Security Group missing rule | Add inbound rule for that port in AWS Console |
| Supabase returns empty results | Document not ingested yet | Run `python injest.py` from project root |
| `match_documents` function not found | Supabase SQL not executed | Run the SQL from the Local Setup section in Supabase SQL editor |

---

## 🙏 Acknowledgements

- Architecture inspired by [this Medium article](https://medium.com/@jushijun/building-a-course-specific-ai-study-assistant-integrating-rag-aws-github-ci-cd-and-docker-c82ddd5f8763) by Shijun Ju
- Vector search powered by [Supabase pgvector](https://supabase.com/docs/guides/ai/vector-columns)

