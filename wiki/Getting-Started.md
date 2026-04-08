# Getting Started

## Option 1: Use the live site (recommended)

The fastest way to start — no install required.

1. Open **[annotator-ten.vercel.app](https://annotator-ten.vercel.app)**
2. Click the **gear icon** in the header to open Settings
3. Pick your AI provider, enter your API key (if needed), and choose a model
4. Click **Save** — you're ready to annotate

Your settings and API key are stored in your browser's `localStorage`. They never leave your machine.

## Option 2: Run locally

Running locally is required if you want to use **Ollama** or other local AI models, since they need `localhost` access.

```bash
git clone https://github.com/donjguido/annotator.git
cd annotator
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Requirements

- Node.js 18+
- npm

## First steps

![Importing a document](https://raw.githubusercontent.com/donjguido/annotator/master/assets/document_import.gif)

1. **Load a document** — Paste text into the editor, or click **Upload** to import a PDF, DOCX, or EPUB
2. **Switch to Annotate mode** — Click the toggle in the header
3. **Highlight text** — Select any passage to create a color-coded annotation
4. **Ask a question** — Click the highlight, type a question in the sidebar, and press Enter
5. **Explore** — Try `/ctx` for full-document context, `/skip` to leave a comment, or `@#1` to link annotations

For a full walkthrough, see the [Features Guide](Features-Guide).

## First-time tutorial

When you open Annotator for the first time, a built-in tutorial walks you through the interface with spotlight popups. You can dismiss it at any time by clicking **Skip tutorial**.
