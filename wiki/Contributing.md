# Contributing

Annotator is open source and contributions are welcome. Whether it's a bug fix, a new feature, better docs, or just a good idea — we appreciate it.

---

## Getting set up

```bash
git clone https://github.com/donjguido/annotator.git
cd annotator
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Available scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Vite, hot reload) |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview the production build locally |

---

## Project structure

```
annotator/
  src/
    Annotator.jsx   # The entire app — all UI, state, AI calls, exports
    App.jsx          # Thin wrapper that renders Annotator
    index.css        # Minimal global styles
  api/
    chat.js          # Vercel serverless CORS proxy for AI API calls
  index.html         # Entry point; loads PDF.js, mammoth.js, JSZip from CDN
  vite.config.js     # Vite configuration
  vercel.json        # Vercel deployment config (rewrites for API + SPA)
  package.json
```

### The single-component architecture

The entire app lives in `src/Annotator.jsx` (~1400 lines). There's no component splitting — all state, rendering, AI calls, and export logic are in one file. This is intentional for now: it keeps the codebase simple and easy to search.

If you're making changes, everything you need is in that one file.

### Key patterns

- **AI providers**: The `PROVIDERS` array defines supported providers. `MODEL_OPTIONS` maps each provider to suggested models. To add a new provider, add an entry to `PROVIDERS` and either write a call function or reuse `callOpenAICompat`.

- **CORS routing**: `aiFetch()` makes API calls directly in local dev, but proxies through `/api/chat` when deployed to Vercel. The `IS_DEPLOYED` flag (checks `window.location.hostname`) controls this.

- **Settings**: All user config is stored in `localStorage` under `annotator_ai_settings` and `annotator_hotkeys`.

- **External libraries**: PDF.js, mammoth.js, and JSZip are loaded via `<script>` tags in `index.html`, not npm. They're accessed as globals (e.g., `window.pdfjsLib`).

---

## Making changes

1. Fork the repo and create a branch
2. Make your changes in `src/Annotator.jsx` (most likely)
3. Test locally with `npm run dev`
4. Run `npm run build` to make sure it compiles
5. Open a pull request with a clear description of what you changed and why

### Things to keep in mind

- The Anthropic API requires the `anthropic-dangerous-direct-browser-access` header for local dev (CORS)
- `max_tokens` is hardcoded to 1000 in all provider call functions
- Export functions are all in `Annotator.jsx` — search for `export` to find them

---

## Reporting bugs & suggesting features

The best place is [GitHub Discussions](https://github.com/donjguido/annotator/discussions). Open a thread and describe:
- What you expected
- What happened instead
- Steps to reproduce (for bugs)

For feature ideas, describe the use case — what problem it solves and how you'd use it.

---

## License

Annotator is MIT-licensed. By contributing, you agree that your contributions will be licensed under the same terms.
