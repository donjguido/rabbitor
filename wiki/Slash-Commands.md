# Slash Commands

Type these at the start of your message in any annotation thread.

| Command | Description |
|---------|-------------|
| `/ctx` | Include the **full document text** as context for this prompt. Without it, only the highlighted passage is sent. |
| `/skip` | Leave a **comment** without calling the AI. Useful for notes and bookmarks. |
| `/search` | Ask with **web search** enabled. Anthropic (Claude) only. |
| `/find` | **Search within** the document text. Highlights matches in the document pane. |
| `/attach` | **Attach a file** as extra context for this annotation thread. The file contents are sent to the AI with each subsequent prompt. |

## Examples

### Include full document context
```
/ctx What are the main arguments in this paper?
```
The AI receives the entire document plus the highlighted passage.

### Leave a comment
```
/skip TODO: revisit this section after the intro is finalized
```
The message is saved to the thread but no AI call is made.

### Web search
```
/search What's the latest research on this topic?
```
Claude searches the web and incorporates results into its response. Only works with the Anthropic provider.

### Search the document
```
/find methodology
```
Highlights all occurrences of "methodology" in the document pane.

### Attach a file
```
/attach
```
Opens a file picker. The selected file's contents become part of the context for every AI prompt in this annotation thread.

## Annotation linking (not a slash command, but related)

- `@#3` — Creates a clickable link to annotation #3
- `@#3+` — Links to annotation #3 **and** imports its highlighted text and recent conversation as context
