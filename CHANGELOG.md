# Changelog

## Unreleased

### Added
- Multi-format document upload: PDF, DOCX, EPUB, HTML, RTF, TXT, Markdown, CSV, and more
- Text extraction for DOCX files via mammoth.js
- Text extraction for EPUB files via JSZip
- HTML/XML tag stripping via DOMParser
- RTF plain text extraction

### Changed
- Upload button accepts all supported document types instead of PDF only
- Upload button no longer disabled while PDF.js loads (only PDFs need it)

## 2026-04-06 — Multi-provider AI support

### Added
- Support for multiple AI providers: Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama, custom OpenAI-compatible
- AI settings panel with provider selection, API key, model, and base URL
- Settings persisted in localStorage

## 2026-04-06 — Attachments, locate, and context-linked annotations

### Added
- Locate button to scroll to a highlight in the document
- File attachments per annotation via `/attach` command
- `@#N+` syntax to link and import another annotation's text and thread as context
- Scroll memory across edit/annotate mode switches

## 2026-04-06 — ID-based annotation linking

### Added
- Stable `@[annotation_id]` linking format that survives reordering and renaming
- `@#N` user input auto-converted to `@[id]` on save
- Legacy `@#N` still rendered as clickable links

## 2026-04-06 — Branching, overlapping highlights, and more

### Added
- Branching edits: save and restore alternate conversation paths
- Overlapping highlights supported
- Per-prompt context control with `/ctx`
- Annotation linking with `@#N`
- Double-click to rename annotations

## 2026-04-05 — Initial release

### Added
- AI-powered document annotation with threaded conversations per highlight
- PDF text extraction via PDF.js
- Plain text paste support
- 5-color highlight palette
- `/skip`, `/search`, `/find` slash commands
- JSON export/import for session persistence
- Markdown export
