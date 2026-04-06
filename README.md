# Annotator

AI-powered document annotation tool. Highlight passages in any text or PDF, then ask Claude questions about them in threaded conversations.

![React](https://img.shields.io/badge/React-19-blue) ![Vite](https://img.shields.io/badge/Vite-6-purple) ![Claude API](https://img.shields.io/badge/Claude-Sonnet_4-orange)

## Features

- **Highlight & Ask** — Select any passage to create a color-coded annotation, then ask Claude about it
- **Overlapping Highlights** — Highlights can overlap; click overlapping text to pick which annotation to view
- **Branching Edits** — Edit a user message and choose "Branch + Regen" to save the old thread as a branch and get a fresh AI response. Switch between branches with the tab bar. Plain "Save" edits in place without branching
- **Per-prompt Context** — Use `/ctx your question` to include full document context for that specific prompt. Without it, only the highlighted passage is sent
- **Annotation Linking** — Type `@#N` in any message to create a clickable link to annotation N (e.g. `@#3`). Links show the annotation name if one is set. Use `@#N+` to link *and* import that annotation's text and recent conversation as context for Claude
- **File Attachments** — Type `/attach` to add a file as extra context for an annotation thread. Attached file contents are sent to Claude with each prompt
- **Jump to Highlight** — Click the locate button (⎈) next to the highlighted passage in the sidebar to scroll the document to that highlight
- **Scroll Position Memory** — Switching between Edit and Annotate modes preserves your scroll position in each
- **Rename Annotations** — Double-click the annotation name in the sidebar header to give it a custom name
- **PDF Upload** — Extract and annotate text from PDF files
- **Threaded Conversations** — Each highlight has its own chat thread
- **Slash Commands**
  - `/ctx` — Include full document context for this prompt
  - `/skip` — Leave a comment without calling Claude
  - `/search` — Ask Claude with web search enabled
  - `/find` — Search within the document text
  - `/attach` — Attach a file as context for this annotation
- **Multi-color Highlights** — 5 color options (Lemon, Rose, Sky, Mint, Lilac) with per-annotation color switching
- **Export** — Copy to clipboard, download as Markdown, or download as JSON
- **Import/Export JSON** — Save your session (including branches) and pick up where you left off
- **Usernames** — Set your name for tracked annotations across collaborators

## Setup

```bash
git clone https://github.com/donjguido/annotator.git
cd annotator
npm install
```

### AI Provider

On first launch, the app opens a **Settings** panel (gear icon in the header) where you configure your AI provider. Supported providers:

| Provider | API Key | Notes |
|----------|---------|-------|
| **Anthropic (Claude)** | Required | Full feature support including `/search` (web search) |
| **OpenAI** | Required | GPT-4o, etc. |
| **Google Gemini** | Required | Gemini 2.0 Flash, etc. |
| **OpenRouter** | Required | Access to many models via single key |
| **Ollama (local)** | Not needed | Runs on `localhost:11434` — no internet required |
| **Custom (OpenAI-compatible)** | Optional | Any OpenAI-compatible endpoint (LM Studio, vLLM, llama.cpp, etc.) |

Settings are saved to `localStorage` — you only configure once per browser.

> **Local models (Ollama, Custom):** These don't need an API key or internet access. Just make sure your local model server is running before using the app. Web search (`/search`) is unavailable with local models.

### Run

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Usage

1. **Paste or upload** — Paste text in Edit mode or upload a PDF
2. **Switch to Annotate** — Click the Annotate toggle
3. **Highlight** — Select text to create a color-coded annotation (overlaps are fine)
4. **Ask** — Type a question in the sidebar and press Enter
5. **Add context** — Prefix with `/ctx` to include the full document
6. **Link annotations** — Reference other annotations with `@#1`, `@#2`, etc. Add `+` (e.g. `@#1+`) to also import that annotation's context
7. **Attach files** — Type `/attach` to add reference files to an annotation thread
8. **Branch** — Edit a message and click "Branch + Regen" to explore alternate responses
9. **Export** — Use the Export menu to save your work

## Tech Stack

- [React 19](https://react.dev) + [Vite 6](https://vite.dev)
- [Claude API](https://docs.anthropic.com/en/docs/about-claude/models) (Sonnet 4)
- [PDF.js](https://mozilla.github.io/pdf.js/) for PDF text extraction
- [Literata](https://fonts.google.com/specimen/Literata) + [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) fonts

## License

MIT
