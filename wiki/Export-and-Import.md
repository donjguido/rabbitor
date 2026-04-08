# Export & Import

![Export options](https://raw.githubusercontent.com/donjguido/annotator/master/assets/export_options.png)

Annotator supports multiple ways to export your annotations and conversations, plus a JSON round-trip for saving and restoring sessions.

Open the **Export menu** from the header (or press `Ctrl+Shift+E`).

---

## Export formats

### Clipboard

Copies all annotations and their conversations to your clipboard as formatted text. Handy for pasting into documents or messages.

### Markdown

Downloads a `.md` file containing all annotations, highlighted passages, conversations, and branches. Good for archiving or sharing on platforms that render Markdown.

### HTML

Downloads a self-contained `.html` file with inline styles. Open it in any browser — no dependencies required. Includes:
- Annotation names and colors
- Highlighted passages
- Full conversation threads
- Branches

### CSV

Downloads a `.csv` file with one row per message. Columns:

| Column | Description |
|--------|-------------|
| Annotation | Annotation number |
| Name | Custom name (if set) |
| Color | Highlight color name |
| Highlighted Text | The annotated passage |
| Role | `user` or `assistant` |
| Author | Username (if set) |
| Message | Message content |
| Timestamp | When the message was sent |

Good for importing into spreadsheets or data analysis tools.

### JSON (full session)

Downloads a `.json` file containing the complete session state — document text, all annotations, conversations, branches, colors, and names. This is the only format that supports **re-importing**.

---

## Import

To restore a previous session:

1. Open Annotator
2. Use the **Import** option (or drag-and-drop a `.json` file)
3. Select a previously exported JSON file

This restores everything: document text, all annotations with their positions, full conversation histories, and branches.

> **Note**: Only JSON export/import preserves the full session. Other formats (Markdown, HTML, CSV, clipboard) are for sharing and archiving — they can't be re-imported.
