# Features Guide

![Annotator workspace with highlights and AI sidebar](https://raw.githubusercontent.com/donjguido/annotator/master/assets/use_display.png)

A detailed look at everything Annotator can do.

---

## Highlighting

Select any text in **Annotate mode** to create a highlight. Each highlight becomes its own annotation with a dedicated chat thread in the sidebar.

### Colors

Five highlight colors are available: **Lemon**, **Rose**, **Sky**, **Mint**, and **Lilac**. Pick a color from the palette before highlighting, or change it later by clicking the color dot in the sidebar.

### Overlapping highlights

Highlights can overlap. When you click overlapping text, a picker lets you choose which annotation to view.

### Jump to highlight

Click the **locate button** (crosshair icon) next to the highlighted passage in the sidebar to scroll the document to that highlight.

---

## Conversations

Each annotation has its own threaded conversation. Type a question in the sidebar input and press Enter to send it to your configured AI.

### Context options

- **Default** — Only the highlighted passage is sent to the AI
- **`/ctx`** — Prefix your message with `/ctx` to include the full document text as context for that specific prompt
- **`@#N+`** — Reference another annotation with `+` to import its text and recent conversation as additional context

### Slash commands

See the full [Slash Commands](Slash-Commands) reference.

### Annotation linking

Type `@#N` (e.g., `@#3`) in any message to create a clickable link to annotation N. If the annotation has a custom name, the link shows that name.

Type `@#N+` to link **and** import that annotation's highlighted text and recent conversation as context for the AI.

### File attachments

Type `/attach` in the input to add a file as extra context for an annotation thread. The file contents are sent to the AI with each prompt in that thread.

---

## Branching

Edit any user message and choose **Branch + Regen** to:
1. Save the current thread as a branch
2. Apply your edit
3. Get a fresh AI response

Switch between branches using the tab bar that appears above the conversation. Choose **Save** instead to edit the message in place without creating a branch.

---

## Naming annotations

Double-click the annotation name in the sidebar header (e.g., "Annotation #1") to give it a custom name. Named annotations are easier to reference with `@#N` links.

---

## Document input

### Paste text

In **Edit mode**, paste or type text directly into the editor.

### Upload files

Click **Upload** to import:
- **PDF** — Text is extracted using PDF.js
- **DOCX** — Converted via mammoth.js
- **EPUB** — Extracted via JSZip + HTML parsing
- **TXT / HTML** — Loaded directly

### Scroll position memory

Switching between Edit and Annotate modes preserves your scroll position in each.

---

## Usernames

Set your name in the sidebar to track who created which annotations — useful if multiple people are working on the same document.

---

## Export & Import

Multiple export formats are available. See [Export and Import](Export-and-Import) for details.

---

## Settings

Click the **gear icon** in the header to configure:
- AI provider and model
- API key
- Custom endpoint URL (for OpenAI-compatible providers)

Settings persist in `localStorage` — you configure once per browser. See [AI Providers](AI-Providers) for provider-specific setup.
