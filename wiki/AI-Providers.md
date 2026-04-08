# AI Providers

![Provider settings panel](https://raw.githubusercontent.com/donjguido/annotator/master/assets/provider_settings.png)

Annotator supports multiple AI providers. Pick the one that fits your needs — all configuration happens in the Settings panel (gear icon).

---

## Supported providers

### Anthropic (Claude)

- **API key**: Required ([get one here](https://console.anthropic.com/))
- **Full feature support** including `/search` (web search via Claude)
- Suggested models:

| Model | Best for |
|-------|----------|
| `claude-opus-4-20250514` | Most capable, complex analysis |
| `claude-sonnet-4-20250514` | Great balance of speed and quality |
| `claude-haiku-4-20250506` | Fastest, lightweight tasks |
| `claude-3-5-sonnet-20241022` | Previous-gen, still excellent |
| `claude-3-5-haiku-20241022` | Previous-gen fast model |

### OpenAI

- **API key**: Required ([get one here](https://platform.openai.com/api-keys))
- Suggested models:

| Model | Best for |
|-------|----------|
| `gpt-4o` | Flagship multimodal model |
| `gpt-4o-mini` | Fast and affordable |
| `gpt-4.1` | Latest generation |
| `gpt-4.1-mini` | Balanced speed/quality |
| `gpt-4.1-nano` | Fastest, cheapest |
| `o4-mini` | Reasoning model (compact) |
| `o3` | Advanced reasoning |

### Google Gemini

- **API key**: Required ([get one here](https://aistudio.google.com/apikey))
- Suggested models:

| Model | Best for |
|-------|----------|
| `gemini-2.5-pro` | Most capable |
| `gemini-2.5-flash` | Fast with thinking |
| `gemini-2.0-flash` | Good all-rounder |
| `gemini-2.0-flash-lite` | Lightweight tasks |
| `gemini-1.5-pro` | Long context |
| `gemini-1.5-flash` | Fast, previous gen |

### OpenRouter

- **API key**: Required ([get one here](https://openrouter.ai/keys))
- Access many providers through a single key
- Suggested models:

| Model | Provider |
|-------|----------|
| `anthropic/claude-sonnet-4` | Anthropic |
| `anthropic/claude-haiku-4` | Anthropic |
| `openai/gpt-4o` | OpenAI |
| `openai/o4-mini` | OpenAI |
| `google/gemini-2.5-pro` | Google |
| `google/gemini-2.5-flash` | Google |
| `deepseek/deepseek-r1` | DeepSeek |
| `deepseek/deepseek-chat-v3` | DeepSeek |
| `meta-llama/llama-4-maverick` | Meta |
| `meta-llama/llama-4-scout` | Meta |

### Ollama (local)

- **API key**: Not needed
- **Runs locally** on `http://localhost:11434` — no internet required
- Must run Annotator locally (not the live site) to use Ollama
- Suggested models:

| Model | Notes |
|-------|-------|
| `llama3.2` | Default, good all-rounder |
| `llama3.1` / `llama3` | Previous Llama versions |
| `mistral` / `mixtral` | Mistral AI models |
| `gemma2` | Google's open model |
| `phi3` | Microsoft's compact model |
| `qwen2.5` | Alibaba's model |
| `deepseek-r1` | Reasoning-focused |
| `command-r` | Cohere's model |

### Custom (OpenAI-compatible)

- **API key**: Optional (depends on your endpoint)
- Works with any OpenAI-compatible API: LM Studio, vLLM, llama.cpp, text-generation-webui, etc.
- Set the **Base URL** to your endpoint (default: `http://localhost:8000`)
- Type your model name directly — no dropdown suggestions

---

## Using custom models

For any provider (except Custom), the Settings dropdown shows suggested models. To use a model not in the list, select **"Other (type model name)..."** at the bottom of the dropdown and type the model ID manually.

---

## Notes

- **Web search** (`/search` command) is only available with Anthropic (Claude)
- **Local providers** (Ollama, Custom) require running Annotator locally — the live site can't reach `localhost`
- All API calls go directly from your browser to the provider. On the live site, calls are proxied through a minimal Vercel serverless function for CORS — your key is never stored server-side
- `max_tokens` is set to 1000 for all providers
