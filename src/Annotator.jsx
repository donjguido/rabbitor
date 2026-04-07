import { useState, useRef, useCallback, useEffect } from "react";

const COLORS = [
  { name: "Lemon", bg: "#FEF3C7", border: "#F59E0B", text: "#92400E" },
  { name: "Rose", bg: "#FCE7F3", border: "#EC4899", text: "#9D174D" },
  { name: "Sky", bg: "#DBEAFE", border: "#3B82F6", text: "#1E3A8A" },
  { name: "Mint", bg: "#D1FAE5", border: "#10B981", text: "#065F46" },
  { name: "Lilac", bg: "#EDE9FE", border: "#8B5CF6", text: "#5B21B6" },
];

const FONT = `'Literata', 'Georgia', serif`;
const MONO = `'JetBrains Mono', 'Fira Code', monospace`;

const TUTORIAL_STEPS = [
  {
    title: "Welcome to Annotator",
    body: "This tool lets you highlight passages in a document and have AI-powered conversations about them. Let\u2019s walk through the basics.",
    target: null, // centered, no spotlight
  },
  {
    title: "Load your document",
    body: "Paste text directly into the editor, or click Upload to import a PDF, DOCX, EPUB, or other supported file.",
    target: "[data-tutorial='upload']",
  },
  {
    title: "Switch to Annotate mode",
    body: "Once your document is loaded, switch to Annotate mode to start highlighting passages.",
    target: "[data-tutorial='mode-toggle']",
  },
  {
    title: "Highlight text",
    body: "Select any text in the document to create a color-coded annotation. Pick a color from the palette, then select text. Overlapping highlights are supported.",
    target: "[data-tutorial='doc-pane']",
  },
  {
    title: "Ask questions in the sidebar",
    body: "Click a highlight to open its thread in the sidebar. Ask the AI questions, leave comments with /skip, or use /ctx to include the full document as context.",
    target: "[data-tutorial='sidebar']",
  },
  {
    title: "Configure your AI provider",
    body: "Click the settings button to connect your preferred AI \u2014 Anthropic, OpenAI, Gemini, OpenRouter, Ollama, or a custom endpoint.",
    target: "[data-tutorial='settings']",
  },
];

const HINTS = [
  "Select text in the document to create a highlight",
  "Type /skip to leave a comment without asking the AI",
  "Type /search to ask Claude with web search enabled",
  "Type /find to search within the document text",
  "Type /ctx to include full document context for one prompt",
  "Type /link or @#N to link to another annotation",
  "Use @#N+ to link and import another annotation as context",
  "Type /attach to add a file as extra context for this thread",
  "Export as JSON, then re-import to pick up where you left off",
  "Click a highlight color dot in the sidebar to change it",
  "Highlights can overlap — click overlapping text to pick one",
  "Double-click an annotation name to rename it",
];

async function extractPdfText(file) {
  const pdfjsLib = window.pdfjsLib;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const c = await page.getTextContent();
    text += (i > 1 ? "\n\n" : "") + c.items.map((x) => x.str).join(" ");
  }
  return text;
}

function extractHtmlText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.querySelectorAll("script, style, noscript")) el.remove();
  return (doc.body?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function extractRtfText(rtf) {
  let text = rtf.replace(/\\par[d]?\b/g, "\n").replace(/\{\\[^{}]*\}/g, "")
    .replace(/\\[a-z]+\d*\s?/gi, "").replace(/[{}]/g, "");
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractDocxText(file) {
  if (!window.mammoth) throw new Error("DOCX library not loaded yet");
  const buf = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return result.value.trim();
}

async function extractEpubText(file) {
  if (!window.JSZip) throw new Error("EPUB library not loaded yet");
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const texts = [];
  const htmlFiles = Object.keys(zip.files).filter(n => /\.(x?html?|xml)$/i.test(n) && !n.endsWith("container.xml") && !n.endsWith("content.opf") && !n.endsWith("toc.ncx")).sort();
  for (const name of htmlFiles) {
    const html = await zip.files[name].async("string");
    const extracted = extractHtmlText(html);
    if (extracted) texts.push(extracted);
  }
  return texts.join("\n\n");
}

const SUPPORTED_DOC_TYPES = ".pdf,.txt,.md,.html,.htm,.rtf,.docx,.epub,.csv,.tsv,.log,.xml,.json";

async function extractFileText(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  switch (ext) {
    case "pdf": return extractPdfText(file);
    case "docx": return extractDocxText(file);
    case "epub": return extractEpubText(file);
    case "htm":
    case "html":
    case "xml": {
      const text = await file.text();
      return extractHtmlText(text);
    }
    case "rtf": {
      const text = await file.text();
      return extractRtfText(text);
    }
    default: return file.text();
  }
}

// --- AI Provider infrastructure ---
const PROVIDERS = [
  { id: "anthropic", name: "Anthropic (Claude)", defaultModel: "claude-sonnet-4-20250514", needsKey: true, supportsSearch: true },
  { id: "openai", name: "OpenAI", defaultModel: "gpt-4o", defaultUrl: "https://api.openai.com", needsKey: true },
  { id: "google", name: "Google Gemini", defaultModel: "gemini-2.0-flash", needsKey: true },
  { id: "openrouter", name: "OpenRouter", defaultModel: "anthropic/claude-sonnet-4", defaultUrl: "https://openrouter.ai/api", needsKey: true },
  { id: "ollama", name: "Ollama (local)", defaultModel: "llama3.2", defaultUrl: "http://localhost:11434", needsKey: false },
  { id: "custom", name: "Custom (OpenAI-compatible)", defaultModel: "", defaultUrl: "http://localhost:8000", needsKey: false },
];

const SETTINGS_KEY = "annotator_ai_settings";
function loadAISettings() {
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); if (s?.provider) return s; } catch {} return null;
}
function saveAISettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

const DEFAULT_HOTKEYS = {
  editMode: { key: "1", ctrl: true, shift: false, alt: false, label: "Edit mode" },
  annotateMode: { key: "2", ctrl: true, shift: false, alt: false, label: "Annotate mode" },
  export: { key: "e", ctrl: true, shift: true, alt: false, label: "Export" },
  settings: { key: ",", ctrl: true, shift: false, alt: false, label: "Settings" },
};
const HOTKEYS_KEY = "annotator_hotkeys";
function loadHotkeys() {
  try {
    const h = JSON.parse(localStorage.getItem(HOTKEYS_KEY));
    if (h && typeof h === "object") {
      // Merge with defaults to pick up any new hotkeys added in future
      const merged = { ...DEFAULT_HOTKEYS };
      for (const k of Object.keys(merged)) {
        if (h[k]) merged[k] = { ...merged[k], ...h[k] };
      }
      return merged;
    }
  } catch {}
  return { ...DEFAULT_HOTKEYS };
}
function saveHotkeys(h) { localStorage.setItem(HOTKEYS_KEY, JSON.stringify(h)); }
function formatHotkey(hk) {
  const parts = [];
  if (hk.ctrl) parts.push("Ctrl");
  if (hk.alt) parts.push("Alt");
  if (hk.shift) parts.push("Shift");
  const keyName = hk.key === "," ? "," : hk.key === " " ? "Space" : hk.key.length === 1 ? hk.key.toUpperCase() : hk.key;
  parts.push(keyName);
  return parts.join("+");
}
function matchesHotkey(e, hk) {
  return e.key.toLowerCase() === hk.key.toLowerCase()
    && e.ctrlKey === hk.ctrl && e.shiftKey === hk.shift && e.altKey === hk.alt;
}

const IS_DEPLOYED = !["localhost", "127.0.0.1"].includes(window.location.hostname);

async function aiFetch(url, options) {
  if (!IS_DEPLOYED) return fetch(url, options);
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, headers: options.headers, body: JSON.parse(options.body) }),
  });
  return res;
}

async function callAnthropic(apiKey, model, messages, system, useWebSearch) {
  const body = { model, max_tokens: 1000, system, messages };
  if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
  if (!IS_DEPLOYED) headers["anthropic-dangerous-direct-browser-access"] = "true";
  const res = await aiFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "No response.";
}

async function callOpenAICompat(baseUrl, apiKey, model, messages, system) {
  const allMessages = [{ role: "system", content: system }, ...messages];
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await aiFetch(`${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: allMessages, max_tokens: 1000 }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || "No response.";
}

async function callGemini(apiKey, model, messages, system) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await aiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: 1000 },
      }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "No response.";
}

async function callAI(settings, { messages, highlightedText, fullDoc, useContext, useWebSearch, linkedContext, attachments }) {
  if (!settings?.provider) throw new Error("No AI provider configured — open Settings (gear icon) to set up.");

  const ctx = useContext ? (fullDoc.length > 6000 ? fullDoc.slice(0, 6000) + "\n…[truncated]" : fullDoc) : "";
  const system = [
    "You are a reading assistant. The user highlighted this passage:",
    `"${highlightedText}"`,
    useContext && ctx ? `\nFull document context:\n${ctx}` : "",
    linkedContext ? `\nLinked annotation context:\n${linkedContext}` : "",
    attachments?.length ? `\nAttached files:\n${attachments.map(a => `--- ${a.name} ---\n${a.content.slice(0, 4000)}`).join("\n\n")}` : "",
    "\nAnswer clearly and concisely (2-5 sentences unless more is needed).",
  ].filter(Boolean).join("\n");

  const { provider, apiKey, model, baseUrl } = settings;
  const prov = PROVIDERS.find(p => p.id === provider);

  if (provider === "anthropic") return callAnthropic(apiKey, model, messages, system, useWebSearch && prov?.supportsSearch);
  if (provider === "google") return callGemini(apiKey, model, messages, system);

  // OpenAI, OpenRouter, Ollama, Custom — all OpenAI-compatible
  const url = provider === "openai" ? "https://api.openai.com"
    : provider === "openrouter" ? "https://openrouter.ai/api"
    : baseUrl || prov?.defaultUrl || "http://localhost:11434";
  return callOpenAICompat(url, apiKey, model, messages, system);
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

function getTextOffset(container, targetNode, targetOffset) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      let el = node.parentElement;
      while (el && el !== container) {
        if (el.dataset.badge === "true") return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let count = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === targetNode) return count + targetOffset;
    count += walker.currentNode.textContent.length;
  }
  return null;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function AutoTextarea({ value, onChange, onKeyDown, placeholder, inputRef, maxH = 120 }) {
  const innerRef = useRef(null);
  const ref = inputRef || innerRef;
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, maxH) + "px";
    }
  }, [value, maxH]);
  return (
    <textarea ref={ref} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder}
      rows={1}
      style={{
        flex: 1, padding: "8px 10px", fontFamily: FONT, fontSize: 13,
        border: "1px solid #d4d0c8", borderRadius: 8, resize: "none",
        background: "#fff", outline: "none", lineHeight: 1.5,
        overflow: "auto", maxHeight: maxH, transition: "height 0.1s ease",
      }} />
  );
}

function MiniColorPicker({ current, onChange, style }) {
  return (
    <div style={{ display: "flex", gap: 3, ...style }}>
      {COLORS.map((c, i) => (
        <button key={i} onClick={(e) => { e.stopPropagation(); onChange(i); }} title={c.name}
          style={{
            width: 14, height: 14, borderRadius: "50%", cursor: "pointer", transition: "all 0.12s",
            border: current === i ? `2px solid ${c.border}` : "1.5px solid #d4d0c8",
            background: c.bg, transform: current === i ? "scale(1.2)" : "scale(1)",
            padding: 0, lineHeight: 0,
          }} />
      ))}
    </div>
  );
}

// Resolve @[id] links (and legacy @#N index links) to clickable annotation references
function MessageContent({ content, annotations, onNavigate }) {
  const parts = [];
  // Match @[id](+)? (ID-based) or @#N(+)? (legacy index-based)
  const regex = /@\[(\d+(?:\.\d+)?)\](\+)?|@#(\d+)(\+)?/g;
  let last = 0;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > last) parts.push(content.slice(last, match.index));
    let anno, hasPlus = false;
    if (match[1] != null) {
      const id = parseFloat(match[1]);
      anno = annotations.find(a => a.id === id);
      hasPlus = match[2] === "+";
    } else {
      const idx = parseInt(match[3]) - 1;
      anno = annotations[idx];
      hasPlus = match[4] === "+";
    }
    if (anno) {
      const c = COLORS[anno.color];
      const label = anno.name || `#${annotations.indexOf(anno) + 1}`;
      parts.push(
        <span key={match.index} onClick={(e) => { e.stopPropagation(); onNavigate(anno.id); }}
          style={{ color: c.border, cursor: "pointer", fontWeight: 500, borderBottom: `1px solid ${c.border}`, fontFamily: MONO, fontSize: 11 }}>
          @{label}{hasPlus && <sup style={{ fontSize: 8, opacity: 0.6 }}>ctx</sup>}
        </span>
      );
    } else {
      parts.push(match[0]);
    }
    last = regex.lastIndex;
  }
  if (last < content.length) parts.push(content.slice(last));
  return <span style={{ whiteSpace: "pre-wrap" }}>{parts}</span>;
}

// Convert @#N(+)? index refs to @[id](+)? for stable linking
function resolveAnnoRefs(text, annotations) {
  return text.replace(/@#(\d+)(\+)?/g, (match, num, plus) => {
    const idx = parseInt(num) - 1;
    const anno = annotations[idx];
    return anno ? `@[${anno.id}]${plus || ""}` : match;
  });
}

// Gather context from @[id]+ references for Claude API calls
function gatherLinkedContext(text, annotations) {
  const regex = /@\[(\d+(?:\.\d+)?)\]\+/g;
  const contexts = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    const id = parseFloat(m[1]);
    const linked = annotations.find(a => a.id === id);
    if (linked) {
      const idx = annotations.indexOf(linked);
      const label = linked.name || `#${idx + 1}`;
      let ctx = `Annotation ${label}: "${linked.text}"`;
      if (linked.thread.length > 0) {
        const recent = linked.thread.slice(-4);
        ctx += "\nRecent conversation:\n" + recent.map(msg => `${msg.role}: ${msg.content}`).join("\n");
      }
      contexts.push(ctx);
    }
  }
  return contexts.join("\n\n---\n\n");
}

export default function Annotator() {
  const [doc, setDoc] = useState("");
  const [fileName, setFileName] = useState("");
  const [annotations, setAnnotations] = useState([]);
  const [activeColor, setActiveColor] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [inputText, setInputText] = useState("");
  const [loadingId, setLoadingId] = useState(null);
  const [mode, setMode] = useState("edit");
  const [copied, setCopied] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [editText, setEditText] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [username, setUsername] = useState("");
  const [showUserEdit, setShowUserEdit] = useState(false);
  const [userDraft, setUserDraft] = useState("");
  const [hintIdx, setHintIdx] = useState(0);
  const [overlapPicker, setOverlapPicker] = useState(null); // { x, y, ids: [] }
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [aiSettings, setAiSettings] = useState(() => loadAISettings());
  const [showSettings, setShowSettings] = useState(() => !loadAISettings());
  const [settingsDraft, setSettingsDraft] = useState(() => {
    const s = loadAISettings();
    return s || { provider: "anthropic", apiKey: "", model: PROVIDERS[0].defaultModel, baseUrl: "" };
  });
  const [settingsStatus, setSettingsStatus] = useState("");
  const [annoMentionIdx, setAnnoMentionIdx] = useState(0);
  const [cmdHintIdx, setCmdHintIdx] = useState(0);
  const [hotkeys, setHotkeys] = useState(() => loadHotkeys());
  const [showHotkeySettings, setShowHotkeySettings] = useState(false);
  const [recordingHotkey, setRecordingHotkey] = useState(null); // action key being recorded
  const [tutorialStep, setTutorialStep] = useState(() => {
    try { return localStorage.getItem("annotator_tutorial_seen") ? null : 0; } catch { return 0; }
  });
  const [tutorialRect, setTutorialRect] = useState(null);
  const textRef = useRef(null);
  const fileRef = useRef(null);
  const importRef = useRef(null);
  const inputRef = useRef(null);
  const threadEndRef = useRef(null);
  const docPaneRef = useRef(null);
  const scrollPosRef = useRef({ edit: 0, annotate: 0 });
  const attachRef = useRef(null);
  const attachTargetRef = useRef(null);
  const editRef = useRef(null);
  const preEditRef = useRef({ start: 0, end: 0 });

  // Warn before unload if there's data that could be lost
  useEffect(() => {
    const handler = (e) => {
      if (doc || annotations.length) { e.preventDefault(); }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [doc, annotations.length]);

  // Prevent edits within annotated regions in the edit textarea
  useEffect(() => {
    const ta = editRef.current;
    if (!ta || mode !== "edit") return;
    const handler = (e) => {
      if (!annotations.length) return;
      let rangeStart = ta.selectionStart;
      let rangeEnd = ta.selectionEnd;
      if (rangeStart === rangeEnd) {
        if (e.inputType === "deleteContentBackward") rangeStart = Math.max(0, rangeStart - 1);
        else if (e.inputType === "deleteContentForward") rangeEnd = Math.min(doc.length, rangeEnd + 1);
      }
      for (const a of annotations) {
        if (rangeStart < a.end && rangeEnd > a.start) { e.preventDefault(); return; }
      }
      preEditRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
    };
    ta.addEventListener("beforeinput", handler);
    return () => ta.removeEventListener("beforeinput", handler);
  }, [mode, annotations, doc]);

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Literata:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      setPdfReady(true);
    };
    document.head.appendChild(script);
    const mammothScript = document.createElement("script");
    mammothScript.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js";
    document.head.appendChild(mammothScript);
    const jszipScript = document.createElement("script");
    jszipScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    document.head.appendChild(jszipScript);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setHintIdx(h => (h + 1) % HINTS.length), 5000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (threadEndRef.current) threadEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [annotations, selectedId, loadingId]);

  useEffect(() => {
    if (selectedId != null) setTimeout(() => inputRef.current?.focus(), 80);
  }, [selectedId]);

  // Tutorial spotlight positioning
  useEffect(() => {
    if (tutorialStep === null) return;
    const step = TUTORIAL_STEPS[tutorialStep];
    if (!step || !step.target) { setTutorialRect(null); return; }
    const update = () => {
      const el = document.querySelector(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        setTutorialRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setTutorialRect(null);
      }
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [tutorialStep]);

  const dismissTutorial = useCallback(() => {
    setTutorialStep(null);
    try { localStorage.setItem("annotator_tutorial_seen", "1"); } catch { /* empty */ }
  }, []);

  // Close overlap picker on outside click
  useEffect(() => {
    if (!overlapPicker) return;
    const close = () => setOverlapPicker(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [overlapPicker]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      // Don't fire when recording a new hotkey
      if (recordingHotkey) return;
      // Ignore if typing in an input/textarea (unless it's a modifier combo)
      const tag = e.target.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable;
      if (inInput && !e.ctrlKey && !e.altKey) return;

      if (matchesHotkey(e, hotkeys.editMode)) {
        e.preventDefault(); switchMode("edit");
      } else if (matchesHotkey(e, hotkeys.annotateMode)) {
        e.preventDefault(); switchMode("annotate");
      } else if (matchesHotkey(e, hotkeys.export)) {
        e.preventDefault(); setShowExportMenu(v => !v);
      } else if (matchesHotkey(e, hotkeys.settings)) {
        e.preventDefault();
        setSettingsDraft(aiSettings || { provider: "anthropic", apiKey: "", model: PROVIDERS[0].defaultModel, baseUrl: "" });
        setSettingsStatus("");
        setShowSettings(s => !s);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [hotkeys, mode, aiSettings, recordingHotkey]);

  // Restore scroll position after mode switch
  useEffect(() => {
    if (docPaneRef.current) {
      setTimeout(() => { docPaneRef.current.scrollTop = scrollPosRef.current[mode]; }, 0);
    }
  }, [mode]);

  const switchMode = (newMode) => {
    if (newMode === mode) return;
    if (docPaneRef.current) scrollPosRef.current[mode] = docPaneRef.current.scrollTop;
    setMode(newMode);
  };

  const handleAttach = (e) => {
    const file = e.target.files?.[0];
    if (!file || !attachTargetRef.current) return;
    const id = attachTargetRef.current;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target.result;
      const ts = new Date().toISOString();
      setAnnotations(prev => prev.map(a => a.id === id
        ? {
            ...a,
            attachments: [...(a.attachments || []), { name: file.name, content, addedAt: ts }],
            thread: [...a.thread, { role: "user", content: `📎 Attached: ${file.name} (${(content.length / 1024).toFixed(1)}KB)`, isComment: true, author: username, timestamp: ts, withContext: false }],
          }
        : a));
    };
    reader.readAsText(file);
    if (attachRef.current) attachRef.current.value = "";
  };

  const scrollToAnno = (annoId) => {
    const el = docPaneRef.current?.querySelector(`[data-anno-id="${annoId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleDocUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfLoading(true);
    try {
      const text = await extractFileText(file);
      if (!text.trim()) throw new Error("No text extracted");
      setDoc(text); setFileName(file.name); setAnnotations([]); setMode("annotate");
    } catch (err) { alert(`Could not extract text from ${file.name}: ${err.message}`); }
    setPdfLoading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.documentText) setDoc(data.documentText);
        if (data.source) setFileName(data.source);
        if (data.annotations) {
          setAnnotations(data.annotations.map(a => ({
            id: a.id || Date.now() + Math.random(),
            start: a.charRange[0],
            end: a.charRange[1],
            text: a.highlightedText,
            name: a.name || "",
            color: COLORS.findIndex(c => c.name === a.color) >= 0 ? COLORS.findIndex(c => c.name === a.color) : 0,
            thread: (a.thread || []).map(m => ({
              role: m.role === "comment" ? "user" : m.role,
              content: m.content,
              isComment: m.role === "comment",
              author: m.author || "",
              timestamp: m.timestamp || null,
              withContext: m.withContext ?? true,
            })),
            branches: (a.branches || []).map(b => ({
              thread: b.thread.map(m => ({
                role: m.role === "comment" ? "user" : m.role,
                content: m.content,
                isComment: m.role === "comment",
                author: m.author || "",
                timestamp: m.timestamp || null,
                withContext: m.withContext ?? true,
              })),
              createdAt: b.createdAt || null,
            })),
            activeBranch: -1,
            attachments: (a.attachments || []).map(att => ({ name: att.name, content: att.content, addedAt: att.addedAt })),
          })));
        }
        setMode("annotate");
      } catch { alert("Could not parse this JSON file."); }
    };
    reader.readAsText(file);
    if (importRef.current) importRef.current.value = "";
  };

  // Overlapping highlights allowed — no overlap check
  const handleSelect = useCallback(() => {
    if (mode !== "annotate" || !textRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!textRef.current.contains(range.startContainer) || !textRef.current.contains(range.endContainer)) return;
    const startOffset = getTextOffset(textRef.current, range.startContainer, range.startOffset);
    const endOffset = getTextOffset(textRef.current, range.endContainer, range.endOffset);
    if (startOffset == null || endOffset == null || startOffset === endOffset) return;
    const s = Math.min(startOffset, endOffset);
    const en = Math.max(startOffset, endOffset);
    const hl = doc.slice(s, en);
    if (!hl.trim()) return;
    const newAnno = { id: Date.now(), start: s, end: en, text: hl, color: activeColor, name: "", thread: [], branches: [], activeBranch: -1, attachments: [] };
    setAnnotations(prev => [...prev, newAnno].sort((a, b) => a.start - b.start));
    setSelectedId(newAnno.id);
    setInputText("");
    sel.removeAllRanges();
  }, [mode, activeColor, doc]);

  const changeAnnoColor = (id, newColor) => {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, color: newColor } : a));
  };

  const renameAnno = (id, newName) => {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, name: newName } : a));
    setRenamingId(null);
    setRenameDraft("");
  };

  const parseCommand = (text) => {
    const trimmed = text.trim();
    if (trimmed.startsWith("/skip")) return { type: "skip", content: trimmed.slice(5).trim() };
    if (trimmed.startsWith("/search ")) return { type: "search", content: trimmed.slice(8).trim() };
    if (trimmed.startsWith("/find ")) return { type: "find", content: trimmed.slice(6).trim() };
    if (trimmed.startsWith("/ctx ")) return { type: "ctx", content: trimmed.slice(5).trim() };
    if (trimmed === "/ctx") return { type: "ctx", content: "" };
    if (trimmed === "/attach") return { type: "attach", content: "" };
    return { type: "ask", content: trimmed };
  };

  const handleFind = (annoId, query) => {
    if (!query) return;
    const lower = doc.toLowerCase();
    const qLower = query.toLowerCase();
    const matches = [];
    let idx = 0;
    while ((idx = lower.indexOf(qLower, idx)) !== -1) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(doc.length, idx + query.length + 80);
      matches.push("…" + doc.slice(start, end).replace(/\n/g, " ") + "…");
      idx += query.length;
    }
    const result = matches.length
      ? `Found ${matches.length} match${matches.length > 1 ? "es" : ""}:\n\n${matches.slice(0, 5).map((m, i) => `${i + 1}. ${m}`).join("\n\n")}${matches.length > 5 ? `\n\n…and ${matches.length - 5} more` : ""}`
      : `No matches found for "${query}".`;
    const ts = new Date().toISOString();
    setAnnotations(prev => prev.map(a => a.id === annoId
      ? { ...a, thread: [...a.thread, { role: "user", content: `/find ${query}`, author: username, timestamp: ts, withContext: false }, { role: "assistant", content: result, author: "system", timestamp: ts }] }
      : a));
  };

  // Helper: append a message to the correct thread (main or branch) regardless of current view
  const appendToThread = (a, branchIdx, msg) => {
    if (a.activeBranch === branchIdx) {
      // Still viewing the same branch — append to active thread
      return { ...a, thread: [...a.thread, msg] };
    }
    if (branchIdx === -1) {
      // Message was sent on main, but we switched to a branch — append to saved main
      return { ...a, _savedMain: [...(a._savedMain || a.thread), msg] };
    }
    // Message was sent on a branch, but we switched away — append to that branch's data
    const newBranches = [...a.branches];
    newBranches[branchIdx] = { ...newBranches[branchIdx], thread: [...newBranches[branchIdx].thread, msg] };
    return { ...a, branches: newBranches };
  };

  const sendMessage = async (id) => {
    const anno = annotations.find(a => a.id === id);
    if (!anno || !inputText.trim()) return;
    const parsed = parseCommand(inputText);
    const ts = new Date().toISOString();
    const sentBranch = anno.activeBranch; // capture which branch we're on at send time

    if (parsed.type === "skip") {
      const comment = parsed.content;
      if (comment) {
        setAnnotations(prev => prev.map(a => a.id === id
          ? { ...a, thread: [...a.thread, { role: "user", content: resolveAnnoRefs(comment, prev), isComment: true, author: username, timestamp: ts, withContext: false }] }
          : a));
      }
      setInputText(""); return;
    }

    if (parsed.type === "find") { handleFind(id, parsed.content); setInputText(""); return; }

    if (parsed.type === "attach") {
      attachTargetRef.current = id;
      attachRef.current?.click();
      setInputText("");
      return;
    }

    const doWebSearch = parsed.type === "search";
    const withContext = parsed.type === "ctx";
    const userContent = parsed.content;
    if (!userContent) return;

    const prefix = (doWebSearch ? "🌐 " : "") + (withContext ? "📄 " : "");
    const newThread = [...anno.thread, { role: "user", content: resolveAnnoRefs(prefix + userContent, annotations), author: username, timestamp: ts, withContext }];
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, thread: newThread } : a));
    setInputText("");
    setLoadingId(id);

    const apiMessages = [];
    for (const m of newThread) {
      if (m.isComment) continue;
      if (apiMessages.length > 0 && apiMessages[apiMessages.length - 1].role === m.role) continue;
      apiMessages.push({ role: m.role, content: m.content });
    }
    if (apiMessages.length > 0 && apiMessages[0].role !== "user") apiMessages.shift();

    const linked = gatherLinkedContext(prefix + userContent, annotations);
    const attachments = anno.attachments || [];

    try {
      const answer = await callAI(aiSettings, { messages: apiMessages, highlightedText: anno.text, fullDoc: doc, useContext: withContext, useWebSearch: doWebSearch, linkedContext: linked, attachments });
      const aiName = PROVIDERS.find(p => p.id === aiSettings?.provider)?.name?.split(" ")[0] || "AI";
      const aiMsg = { role: "assistant", content: answer, author: aiName, timestamp: new Date().toISOString() };
      setAnnotations(prev => prev.map(a => a.id === id ? appendToThread(a, sentBranch, aiMsg) : a));
    } catch (err) {
      const errMsg = { role: "assistant", content: err?.message || "Error getting response.", author: "AI", timestamp: new Date().toISOString(), isError: true };
      setAnnotations(prev => prev.map(a => a.id === id ? appendToThread(a, sentBranch, errMsg) : a));
    }
    setLoadingId(null);
  };

  // Edit: simple save (in-place) — no AI regen
  const saveEditSimple = (annoId, msgIdx) => {
    setAnnotations(prev => prev.map(a => {
      if (a.id !== annoId) return a;
      const t = [...a.thread]; t[msgIdx] = { ...t[msgIdx], content: resolveAnnoRefs(editText, prev), editedAt: new Date().toISOString() };
      return { ...a, thread: t };
    }));
    setEditingNote(null); setEditText("");
  };

  // Edit: branch — save old thread, truncate, edit, regenerate AI
  const saveEditBranch = async (annoId, msgIdx) => {
    const anno = annotations.find(a => a.id === annoId);
    if (!anno) return;
    setEditingNote(null);

    // Save current thread as a branch
    const branchSnapshot = { thread: [...anno.thread], createdAt: new Date().toISOString() };

    // Truncate thread to the edit point (keep messages 0..msgIdx-1), then add edited message
    const editedMsg = { ...anno.thread[msgIdx], content: resolveAnnoRefs(editText, annotations), editedAt: new Date().toISOString() };
    const truncated = [...anno.thread.slice(0, msgIdx), editedMsg];

    const newBranches = [...anno.branches, branchSnapshot];
    setAnnotations(prev => prev.map(a => a.id === annoId
      ? { ...a, thread: truncated, branches: newBranches, activeBranch: -1 }
      : a));
    setEditText("");

    // If the edited message is a user message (not a comment), regenerate AI response
    if (editedMsg.role === "user" && !editedMsg.isComment) {
      setLoadingId(annoId);
      const apiMessages = [];
      for (const m of truncated) {
        if (m.isComment) continue;
        if (apiMessages.length > 0 && apiMessages[apiMessages.length - 1].role === m.role) continue;
        apiMessages.push({ role: m.role, content: m.content });
      }
      if (apiMessages.length > 0 && apiMessages[0].role !== "user") apiMessages.shift();

      try {
        const answer = await callAI(aiSettings, { messages: apiMessages, highlightedText: anno.text, fullDoc: doc, useContext: editedMsg.withContext || false, useWebSearch: false });
        const aiName = PROVIDERS.find(p => p.id === aiSettings?.provider)?.name?.split(" ")[0] || "AI";
        const aiMsg = { role: "assistant", content: answer, author: aiName, timestamp: new Date().toISOString() };
        setAnnotations(prev => prev.map(a => a.id === annoId ? appendToThread(a, -1, aiMsg) : a));
      } catch (err) {
        const errMsg = { role: "assistant", content: err?.message || "Error getting response.", author: "AI", timestamp: new Date().toISOString(), isError: true };
        setAnnotations(prev => prev.map(a => a.id === annoId ? appendToThread(a, -1, errMsg) : a));
      }
      setLoadingId(null);
    }
  };

  const switchBranch = (annoId, branchIdx) => {
    // branchIdx = -1 means current/main thread, 0+ means a saved branch
    setAnnotations(prev => prev.map(a => {
      if (a.id !== annoId) return a;
      if (branchIdx === a.activeBranch) return a;

      // Save current thread back to its source before switching
      let updated = a;
      if (a.activeBranch >= 0) {
        const newBranches = [...a.branches];
        newBranches[a.activeBranch] = { ...newBranches[a.activeBranch], thread: a.thread };
        updated = { ...updated, branches: newBranches };
      }

      // If currently viewing main thread and switching to a branch
      if (a.activeBranch === -1 && branchIdx >= 0) {
        return { ...updated, _savedMain: a.thread, thread: updated.branches[branchIdx].thread, activeBranch: branchIdx };
      }
      // If currently viewing a branch and switching to main
      if (a.activeBranch >= 0 && branchIdx === -1) {
        return { ...updated, thread: a._savedMain || a.thread, _savedMain: undefined, activeBranch: -1 };
      }
      // Switching between branches
      if (a.activeBranch >= 0 && branchIdx >= 0) {
        return { ...updated, thread: updated.branches[branchIdx].thread, activeBranch: branchIdx };
      }
      return a;
    }));
  };

  const deleteAnno = (id) => { setAnnotations(prev => prev.filter(a => a.id !== id)); if (selectedId === id) setSelectedId(null); };
  const deleteMessage = (annoId, msgIdx) => { setAnnotations(prev => prev.map(a => a.id !== annoId ? a : { ...a, thread: a.thread.slice(0, msgIdx) })); };

  const exportMarkdown = () => {
    if (!annotations.length) return;
    let md = `# Annotations${fileName ? ` — ${fileName}` : ""}\n\n`;
    annotations.forEach((a, i) => {
      const label = a.name || `Annotation ${i + 1}`;
      md += `## ${label} (${COLORS[a.color].name})\n\n> ${a.text}\n\n`;
      a.thread.forEach(m => {
        const who = m.author || (m.role === "user" ? "User" : "Claude");
        const time = m.timestamp ? ` (${new Date(m.timestamp).toLocaleString()})` : "";
        if (m.isComment) md += `**💬 ${who}${time}:** ${m.content}\n\n`;
        else if (m.role === "user") md += `**Q — ${who}${time}:** ${m.content}\n\n`;
        else md += `**A — ${who}${time}:** ${m.content}\n\n`;
      });
      if (a.branches.length > 0) {
        md += `### Branches (${a.branches.length})\n\n`;
        a.branches.forEach((b, bi) => {
          md += `#### Branch ${bi + 1} (${new Date(b.createdAt).toLocaleString()})\n\n`;
          b.thread.forEach(m => {
            const who = m.author || (m.role === "user" ? "User" : "Claude");
            if (m.isComment) md += `**💬 ${who}:** ${m.content}\n\n`;
            else if (m.role === "user") md += `**Q — ${who}:** ${m.content}\n\n`;
            else md += `**A — ${who}:** ${m.content}\n\n`;
          });
        });
      }
      md += `---\n\n`;
    });
    downloadFile(md, `annotations${fileName ? "_" + fileName.replace(/\.pdf$/i, "") : ""}.md`, "text/markdown");
  };

  const exportJSON = () => {
    if (!annotations.length) return;
    const data = {
      source: fileName || "pasted text",
      documentText: doc,
      exported: new Date().toISOString(),
      annotations: annotations.map((a, i) => ({
        id: a.id, index: i + 1, name: a.name || "", color: COLORS[a.color].name, charRange: [a.start, a.end], highlightedText: a.text,
        attachments: (a.attachments || []).map(att => ({ name: att.name, content: att.content, addedAt: att.addedAt })),
        thread: a.thread.map(m => ({ role: m.isComment ? "comment" : m.role, content: m.content, author: m.author || "", timestamp: m.timestamp || null, withContext: m.withContext || false })),
        branches: a.branches.map(b => ({
          createdAt: b.createdAt,
          thread: b.thread.map(m => ({ role: m.isComment ? "comment" : m.role, content: m.content, author: m.author || "", timestamp: m.timestamp || null, withContext: m.withContext || false })),
        })),
      })),
    };
    downloadFile(JSON.stringify(data, null, 2), `annotations${fileName ? "_" + fileName.replace(/\.pdf$/i, "") : ""}.json`, "application/json");
  };

  const exportClipboard = () => {
    if (!annotations.length) return;
    const lines = annotations.map((a, i) => {
      const label = a.name || `#${i + 1}`;
      const quote = `"${a.text.length > 150 ? a.text.slice(0, 150) + "…" : a.text}"`;
      const msgs = a.thread.map(m => {
        const who = m.author ? ` [${m.author}]` : "";
        if (m.isComment) return `   💬${who} ${m.content}`;
        return `   ${m.role === "user" ? "Q" : "A"}${who}: ${m.content}`;
      }).join("\n");
      return `${label}. ${quote}${msgs ? "\n" + msgs : ""}`;
    }).join("\n\n");
    navigator.clipboard.writeText(`Annotations${fileName ? ` — ${fileName}` : ""}:\n\n${lines}`).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  // Render document text with overlapping highlight support
  const renderText = () => {
    if (!doc) return null;
    if (!annotations.length) return doc;

    // Build boundary events
    const events = [];
    annotations.forEach(a => {
      events.push({ pos: a.start, type: "start", id: a.id });
      events.push({ pos: a.end, type: "end", id: a.id });
    });
    // Sort: by position, then ends before starts at same position
    events.sort((a, b) => a.pos - b.pos || (a.type === "end" ? -1 : 1));

    // Collect unique boundary positions
    const positions = [];
    const seen = new Set();
    for (const e of events) {
      if (!seen.has(e.pos)) { positions.push(e.pos); seen.add(e.pos); }
    }

    const parts = [];
    const active = new Set();
    let last = 0;

    for (const pos of positions) {
      // Render segment from last to pos with current active set
      if (pos > last) {
        const segment = doc.slice(last, pos);
        if (active.size === 0) {
          parts.push(<span key={`t-${last}`}>{segment}</span>);
        } else {
          const activeAnnos = annotations.filter(a => active.has(a.id));
          parts.push(renderHighlightSegment(last, segment, activeAnnos));
        }
      }
      // Process events at this position
      for (const e of events) {
        if (e.pos !== pos) continue;
        if (e.type === "start") active.add(e.id);
        else active.delete(e.id);
      }
      last = pos;
    }

    // Remaining text after all boundaries
    if (last < doc.length) {
      if (active.size === 0) {
        parts.push(<span key={`t-${last}`}>{doc.slice(last)}</span>);
      } else {
        const activeAnnos = annotations.filter(a => active.has(a.id));
        parts.push(renderHighlightSegment(last, doc.slice(last), activeAnnos));
      }
    }

    return parts;
  };

  const renderHighlightSegment = (offset, text, activeAnnos) => {
    // Use the most recently added annotation for primary color
    const primary = activeAnnos[activeAnnos.length - 1];
    const c = COLORS[primary.color];
    const isSelected = activeAnnos.some(a => a.id === selectedId);
    const isOverlap = activeAnnos.length > 1;

    // For overlaps, create a striped gradient with all colors
    let bg;
    if (isOverlap) {
      if (isSelected) {
        const selAnno = activeAnnos.find(a => a.id === selectedId);
        bg = COLORS[selAnno ? selAnno.color : primary.color].border + "33";
      } else {
        const stops = activeAnnos.map((a, i) => {
          const col = COLORS[a.color].bg;
          const pct1 = (i / activeAnnos.length * 100).toFixed(0);
          const pct2 = ((i + 1) / activeAnnos.length * 100).toFixed(0);
          return `${col} ${pct1}%, ${col} ${pct2}%`;
        }).join(", ");
        bg = `linear-gradient(135deg, ${stops})`;
      }
    } else {
      bg = isSelected ? c.border + "33" : c.bg;
    }

    // Show badge only at the end of each annotation's range
    const badges = [];
    for (const a of activeAnnos) {
      if (offset + text.length === a.end && a.thread.length > 0) {
        const ac = COLORS[a.color];
        const qCount = a.thread.filter(m => m.role === "user").length;
        badges.push(
          <sup key={`b-${a.id}`} data-badge="true" style={{ fontSize: 9, color: ac.border, fontFamily: MONO, fontWeight: 500, marginLeft: 1 }}>
            {qCount || "•"}
          </sup>
        );
      }
    }

    const handleClick = (e) => {
      e.stopPropagation();
      if (activeAnnos.length === 1) {
        setSelectedId(activeAnnos[0].id);
        setInputText("");
      } else {
        // Show overlap picker
        setOverlapPicker({ x: e.clientX, y: e.clientY, ids: activeAnnos.map(a => a.id) });
      }
    };

    // Border: use gradient for overlaps
    let borderBottom;
    if (isOverlap) {
      const colors = activeAnnos.map(a => COLORS[a.color].border);
      borderBottom = `2px solid ${colors[0]}`;
    } else {
      borderBottom = `2px solid ${c.border}`;
    }

    return (
      <span key={`h-${offset}`} data-anno-id={primary.id} onClick={handleClick}
        style={{
          background: bg, borderBottom, borderRadius: 2, cursor: "pointer",
          padding: "1px 0", transition: "all 0.15s ease",
          outline: isSelected ? `2px solid ${c.border}` : "none", outlineOffset: 1,
        }}>
        {text}
        {isOverlap && (
          <sup data-badge="true" style={{ fontSize: 8, color: "#666", fontFamily: MONO, marginLeft: 1 }}>
            ×{activeAnnos.length}
          </sup>
        )}
        {badges}
      </span>
    );
  };

  const currentAnno = annotations.find(a => a.id === selectedId);
  const currentThread = currentAnno ? currentAnno.thread : [];
  const isViewingBranch = currentAnno && currentAnno.activeBranch >= 0;
  const cmdHints = [
    { cmd: "/skip", desc: "comment (no AI)" },
    { cmd: "/search", desc: "ask + web search" },
    { cmd: "/find", desc: "search in document" },
    { cmd: "/ctx", desc: "ask with full doc context" },
    { cmd: "/attach", desc: "attach a file as context" },
    { cmd: "/link", desc: "link to another annotation" },
  ];

  const getAnnoLabel = (a, i) => a.name || `#${i + 1}`;

  // Annotation mention autocomplete: detect @# or /link pattern at cursor
  const getAnnoMention = () => {
    const el = inputRef.current;
    if (!el || annotations.length === 0) return null;
    const pos = el.selectionStart;
    const before = inputText.slice(0, pos);
    // Match @#N(+)? or /link (with optional query after space)
    const match = before.match(/@#(\d*)(\+)?$/) || before.match(/^\/link(?:\s+(.*))?$/);
    if (!match) return null;
    const isLinkCmd = before.startsWith("/link");
    const query = isLinkCmd ? (match[1] || "").trim() : match[1];
    const startPos = isLinkCmd ? 0 : before.length - match[0].length;
    const filtered = annotations.map((a, i) => ({ anno: a, idx: i, label: getAnnoLabel(a, i) }))
      .filter(item => item.anno.id !== (currentAnno?.id ?? null)) // exclude current annotation
      .filter(item => {
        if (!query) return true;
        const q = query.toLowerCase();
        const num = String(item.idx + 1);
        const name = (item.anno.name || "").toLowerCase();
        const text = item.anno.text.toLowerCase();
        return num.startsWith(query) || name.includes(q) || (isLinkCmd && text.includes(q));
      });
    return filtered.length > 0 ? { items: filtered, startPos, fullMatch: match[0] } : null;
  };
  const annoMention = getAnnoMention();

  // Reset highlight index when suggestions change
  useEffect(() => {
    setAnnoMentionIdx(0);
  }, [annoMention?.items?.length, annoMention?.startPos]);

  // Reset command hint index when input changes
  useEffect(() => {
    setCmdHintIdx(0);
  }, [inputText]);

  const insertAnnoMention = (item, plus = false) => {
    const mention = annoMention;
    if (!mention) return;
    const replacement = `@#${item.idx + 1}${plus ? "+" : ""} `;
    // For /link command, replace entire input; for @# inline, replace just the match
    const afterPos = mention.startPos === 0 && inputText.startsWith("/link") ? inputText.length : (inputRef.current?.selectionStart ?? inputText.length);
    const newText = inputText.slice(0, mention.startPos) + replacement + inputText.slice(afterPos);
    setInputText(newText);
    setTimeout(() => {
      if (inputRef.current) {
        const newPos = mention.startPos + replacement.length;
        inputRef.current.selectionStart = inputRef.current.selectionEnd = newPos;
        inputRef.current.focus();
      }
    }, 0);
  };

  return (
    <div style={{ fontFamily: FONT, height: "100vh", display: "flex", flexDirection: "column", background: "#FAF9F6", color: "#1a1a1a" }}>
      {/* Header */}
      <div style={{ padding: "10px 20px", borderBottom: "1px solid #e5e2db", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>Annotator</h1>
            <p style={{ margin: "1px 0 0", fontSize: 11, opacity: 0.45, fontFamily: MONO }}>{fileName ? `📄 ${fileName}` : "paste or upload a document → highlight → ask"}</p>
          </div>
          <div style={{ marginLeft: 8 }}>
            {showUserEdit ? (
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input value={userDraft} onChange={e => setUserDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { setUsername(userDraft.trim()); setShowUserEdit(false); } }}
                  placeholder="Your name…" autoFocus
                  style={{ padding: "3px 8px", fontFamily: MONO, fontSize: 11, border: "1px solid #d4d0c8", borderRadius: 5, outline: "none", width: 110 }} />
                <button onClick={() => { setUsername(userDraft.trim()); setShowUserEdit(false); }}
                  style={{ padding: "3px 6px", borderRadius: 4, border: "none", background: "#1a1a1a", color: "#fff", fontSize: 10, fontFamily: MONO, cursor: "pointer" }}>✓</button>
              </div>
            ) : (
              <button onClick={() => { setUserDraft(username); setShowUserEdit(true); }}
                style={{ padding: "3px 10px", borderRadius: 12, border: "1px solid #d4d0c8", background: username ? "#EDE9FE" : "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11, transition: "all 0.15s" }}>
                {username ? `👤 ${username}` : "👤 Set name"}
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input ref={fileRef} type="file" accept={SUPPORTED_DOC_TYPES} onChange={handleDocUpload} style={{ display: "none" }} />
          <input ref={importRef} type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />
          <input ref={attachRef} type="file" onChange={handleAttach} style={{ display: "none" }} />
          <button data-tutorial="upload" onClick={() => fileRef.current?.click()} disabled={pdfLoading}
            style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #d4d0c8", background: pdfLoading ? "#FEF3C7" : "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
            {pdfLoading ? "⏳…" : "📄 Upload"}
          </button>
          <button onClick={() => importRef.current?.click()}
            style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #d4d0c8", background: "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
            📥 Import
          </button>
          <div data-tutorial="mode-toggle" style={{ display: "flex", borderRadius: 7, overflow: "hidden", border: "1px solid #d4d0c8" }}>
            {["edit", "annotate"].map(m => (
              <button key={m} onClick={() => switchMode(m)}
                title={formatHotkey(hotkeys[m === "edit" ? "editMode" : "annotateMode"])}
                style={{ padding: "5px 10px", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 11, background: mode === m ? "#1a1a1a" : "transparent", color: mode === m ? "#fff" : "#1a1a1a", transition: "all 0.15s" }}>
                {m === "edit" ? "✏️ Edit" : "🖍️ Annotate"}
              </button>
            ))}
          </div>
          {mode === "annotate" && annotations.length > 0 && (
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowExportMenu(v => !v)}
                title={formatHotkey(hotkeys.export)}
                style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #d4d0c8", background: copied ? "#D1FAE5" : "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
                {copied ? "✓ Copied!" : "📋 Export ▾"}
              </button>
              {showExportMenu && (
                <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#fff", border: "1px solid #d4d0c8", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 20, overflow: "hidden", minWidth: 180 }}
                  onClick={e => e.stopPropagation()}>
                  {[
                    { label: "📋 Copy to clipboard", fn: () => { exportClipboard(); setShowExportMenu(false); } },
                    { label: "📝 Download Markdown", fn: () => { exportMarkdown(); setShowExportMenu(false); } },
                    { label: "📦 Download JSON", fn: () => { exportJSON(); setShowExportMenu(false); } },
                  ].map((item, i) => (
                    <button key={i} onClick={item.fn}
                      style={{ display: "block", width: "100%", padding: "10px 14px", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: MONO, fontSize: 11, borderBottom: i < 2 ? "1px solid #f0ede8" : "none" }}
                      onMouseEnter={e => e.target.style.background = "#f7f6f3"} onMouseLeave={e => e.target.style.background = "transparent"}>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button data-tutorial="settings" onClick={() => { setSettingsDraft(aiSettings || { provider: "anthropic", apiKey: "", model: PROVIDERS[0].defaultModel, baseUrl: "" }); setSettingsStatus(""); setShowSettings(true); }}
            title={`AI Provider Settings (${formatHotkey(hotkeys.settings)})`}
            style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${aiSettings ? "#d4d0c8" : "#f59e0b"}`, background: aiSettings ? "transparent" : "#FEF3C7", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
            ⚙️{aiSettings ? "" : " Setup AI"}
          </button>
          <a href="https://github.com/donjguido/annotator" target="_blank" rel="noopener noreferrer"
            title="View on GitHub"
            style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid #d4d0c8", display: "flex", alignItems: "center", color: "#1a1a1a", textDecoration: "none", lineHeight: 1 }}>
            <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          </a>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowSettings(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 420, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 8px 30px rgba(0,0,0,0.15)", fontFamily: FONT }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>AI Provider Settings</h2>
              <button onClick={() => setShowSettings(false)} style={{ border: "none", background: "transparent", fontSize: 16, cursor: "pointer", opacity: 0.4 }}>✕</button>
            </div>

            <label style={{ display: "block", fontSize: 11, fontFamily: MONO, opacity: 0.5, marginBottom: 4, textTransform: "uppercase" }}>Provider</label>
            <select value={settingsDraft.provider} onChange={e => {
              const p = PROVIDERS.find(x => x.id === e.target.value);
              setSettingsDraft(prev => ({ ...prev, provider: e.target.value, model: p?.defaultModel || "", baseUrl: p?.defaultUrl || prev.baseUrl }));
              setSettingsStatus("");
            }}
              style={{ width: "100%", padding: "8px 10px", fontFamily: MONO, fontSize: 12, border: "1px solid #d4d0c8", borderRadius: 6, marginBottom: 12, outline: "none", background: "#fff" }}>
              {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            {PROVIDERS.find(p => p.id === settingsDraft.provider)?.needsKey && (
              <>
                <label style={{ display: "block", fontSize: 11, fontFamily: MONO, opacity: 0.5, marginBottom: 4, textTransform: "uppercase" }}>API Key</label>
                <input type="password" value={settingsDraft.apiKey || ""} onChange={e => { setSettingsDraft(prev => ({ ...prev, apiKey: e.target.value })); setSettingsStatus(""); }}
                  placeholder={`Enter your ${PROVIDERS.find(p => p.id === settingsDraft.provider)?.name} API key`}
                  style={{ width: "100%", padding: "8px 10px", fontFamily: MONO, fontSize: 12, border: "1px solid #d4d0c8", borderRadius: 6, marginBottom: 12, outline: "none", boxSizing: "border-box" }} />
              </>
            )}

            <label style={{ display: "block", fontSize: 11, fontFamily: MONO, opacity: 0.5, marginBottom: 4, textTransform: "uppercase" }}>Model</label>
            <input value={settingsDraft.model || ""} onChange={e => { setSettingsDraft(prev => ({ ...prev, model: e.target.value })); setSettingsStatus(""); }}
              placeholder="Model name"
              style={{ width: "100%", padding: "8px 10px", fontFamily: MONO, fontSize: 12, border: "1px solid #d4d0c8", borderRadius: 6, marginBottom: 12, outline: "none", boxSizing: "border-box" }} />

            {(settingsDraft.provider === "ollama" || settingsDraft.provider === "custom") && (
              <>
                <label style={{ display: "block", fontSize: 11, fontFamily: MONO, opacity: 0.5, marginBottom: 4, textTransform: "uppercase" }}>Base URL</label>
                <input value={settingsDraft.baseUrl || ""} onChange={e => { setSettingsDraft(prev => ({ ...prev, baseUrl: e.target.value })); setSettingsStatus(""); }}
                  placeholder="http://localhost:11434"
                  style={{ width: "100%", padding: "8px 10px", fontFamily: MONO, fontSize: 12, border: "1px solid #d4d0c8", borderRadius: 6, marginBottom: 12, outline: "none", boxSizing: "border-box" }} />
              </>
            )}

            {IS_DEPLOYED && (settingsDraft.provider === "ollama" || settingsDraft.provider === "custom") && (
              <p style={{ fontSize: 11, fontFamily: MONO, margin: "0 0 12px", lineHeight: 1.5, padding: "8px 10px", borderRadius: 6, background: "#FEF3C7", border: "1px solid #FCD34D" }}>
                Local providers don't work on the hosted web app — the server can't reach your localhost.{" "}
                <a href="https://github.com/donjguido/annotator#running-locally" target="_blank" rel="noopener noreferrer" style={{ color: "#92400e" }}>Run it locally</a> instead.
              </p>
            )}

            {!PROVIDERS.find(p => p.id === settingsDraft.provider)?.supportsSearch && (
              <p style={{ fontSize: 11, fontFamily: MONO, opacity: 0.4, margin: "0 0 12px", lineHeight: 1.5 }}>
                Note: /search (web search) is only available with Anthropic. Other providers will ignore it.
              </p>
            )}

            {settingsStatus && (
              <div style={{ padding: "8px 10px", borderRadius: 6, marginBottom: 12, fontSize: 11, fontFamily: MONO,
                background: settingsStatus.startsWith("✓") ? "#D1FAE5" : settingsStatus.startsWith("✕") ? "#FEE2E2" : "#FEF3C7",
                border: `1px solid ${settingsStatus.startsWith("✓") ? "#6EE7B7" : settingsStatus.startsWith("✕") ? "#FCA5A5" : "#FCD34D"}`,
              }}>
                {settingsStatus}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={async () => {
                setSettingsStatus("Testing…");
                try {
                  await callAI(settingsDraft, {
                    messages: [{ role: "user", content: "Say 'OK' and nothing else." }],
                    highlightedText: "test", fullDoc: "", useContext: false, useWebSearch: false,
                  });
                  setSettingsStatus("✓ Connection successful!");
                } catch (err) {
                  setSettingsStatus(`✕ ${err.message}`);
                }
              }}
                style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #d4d0c8", background: "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
                Test Connection
              </button>
              <button onClick={() => {
                setAiSettings(settingsDraft);
                saveAISettings(settingsDraft);
                setShowSettings(false);
                setSettingsStatus("");
              }}
                style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#1a1a1a", color: "#fff", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
                Save
              </button>
            </div>

            {/* Keyboard shortcuts */}
            <div style={{ borderTop: "1px solid #e8e5e0", marginTop: 16, paddingTop: 16 }}>
              <button onClick={() => setShowHotkeySettings(v => !v)}
                style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11, opacity: 0.6, padding: 0 }}>
                <span style={{ transform: showHotkeySettings ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
                Keyboard Shortcuts
              </button>
              {showHotkeySettings && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {Object.entries(hotkeys).map(([action, hk]) => (
                    <div key={action} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 12, fontFamily: MONO, minWidth: 120 }}>{hk.label}</span>
                      <button
                        onClick={() => setRecordingHotkey(action)}
                        onKeyDown={(e) => {
                          if (recordingHotkey !== action) return;
                          if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return; // wait for actual key
                          e.preventDefault();
                          e.stopPropagation();
                          const updated = { ...hotkeys, [action]: { ...hk, key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey } };
                          setHotkeys(updated);
                          saveHotkeys(updated);
                          setRecordingHotkey(null);
                        }}
                        onBlur={() => { if (recordingHotkey === action) setRecordingHotkey(null); }}
                        style={{
                          padding: "4px 10px", borderRadius: 5, fontFamily: MONO, fontSize: 11, cursor: "pointer", minWidth: 100, textAlign: "center",
                          border: recordingHotkey === action ? "2px solid #3B82F6" : "1px solid #d4d0c8",
                          background: recordingHotkey === action ? "#DBEAFE" : "#f7f6f3",
                          color: recordingHotkey === action ? "#1E3A8A" : "#1a1a1a",
                        }}>
                        {recordingHotkey === action ? "Press keys…" : formatHotkey(hk)}
                      </button>
                    </div>
                  ))}
                  <button onClick={() => { setHotkeys({ ...DEFAULT_HOTKEYS }); saveHotkeys({ ...DEFAULT_HOTKEYS }); }}
                    style={{ alignSelf: "flex-end", marginTop: 4, padding: "4px 10px", borderRadius: 5, border: "1px solid #d4d0c8", background: "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 10, opacity: 0.5 }}>
                    Reset to defaults
                  </button>
                </div>
              )}
            </div>

            {/* Replay tutorial */}
            <div style={{ borderTop: "1px solid #e8e5e0", marginTop: 16, paddingTop: 16 }}>
              <button onClick={() => { setShowSettings(false); setTutorialStep(0); }}
                style={{ border: "none", background: "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11, opacity: 0.6, padding: 0 }}>
                ? Replay Tutorial
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }} onClick={() => { showExportMenu && setShowExportMenu(false); }}>
        {/* Document pane */}
        <div ref={docPaneRef} data-tutorial="doc-pane" style={{ flex: 1, overflowY: "auto", padding: 24, position: "relative" }}>
          {mode === "edit" ? (
            <div style={{ position: "relative", width: "100%", minHeight: 400 }}>
              {/* Backdrop with highlighted annotation regions */}
              {annotations.length > 0 && (
                <div aria-hidden style={{
                  position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                  padding: 20, fontFamily: FONT, fontSize: 15, lineHeight: 1.75,
                  border: "1px solid transparent", borderRadius: 10,
                  whiteSpace: "pre-wrap", wordWrap: "break-word", overflow: "hidden",
                  pointerEvents: "none", color: "transparent", boxSizing: "border-box",
                }}>
                  {(() => {
                    const sorted = [...annotations].sort((a, b) => a.start - b.start);
                    // Merge overlapping ranges
                    const merged = [];
                    for (const a of sorted) {
                      if (merged.length && a.start <= merged[merged.length - 1][1]) {
                        merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], a.end);
                      } else {
                        merged.push([a.start, a.end]);
                      }
                    }
                    const parts = [];
                    let pos = 0;
                    for (const [s, e] of merged) {
                      if (pos < s) parts.push(<span key={`g-${pos}`}>{doc.slice(pos, s)}</span>);
                      parts.push(<span key={`h-${s}`} style={{ background: "#e0ddd6", borderRadius: 3 }}>{doc.slice(s, e)}</span>);
                      pos = e;
                    }
                    if (pos < doc.length) parts.push(<span key={`g-${pos}`}>{doc.slice(pos)}</span>);
                    return parts;
                  })()}
                </div>
              )}
              {/* Textarea on top */}
              <textarea ref={editRef} value={doc} onChange={e => {
                  const newText = e.target.value;
                  if (!annotations.length) { setDoc(newText); return; }
                  const { start: selStart, end: selEnd } = preEditRef.current;
                  const delta = newText.length - doc.length;
                  setDoc(newText);
                  if (delta !== 0) {
                    setAnnotations(prev => prev.map(a => {
                      if (a.start >= selEnd) return { ...a, start: a.start + delta, end: a.end + delta };
                      return a;
                    }));
                  }
                }}
                placeholder="Paste your document text here, or upload a file (PDF, DOCX, EPUB, HTML, TXT, MD, RTF, CSV)…"
                style={{ position: "relative", width: "100%", height: "100%", minHeight: 400, padding: 20, fontFamily: FONT, fontSize: 15, lineHeight: 1.75, border: "1px solid #d4d0c8", borderRadius: 10, resize: "none", background: annotations.length > 0 ? "transparent" : "#fff", color: "#1a1a1a", outline: "none", boxSizing: "border-box", caretColor: "#1a1a1a" }} />
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontFamily: MONO, opacity: 0.5, marginRight: 4 }}>color:</span>
                {COLORS.map((c, i) => (
                  <button key={i} onClick={() => setActiveColor(i)} title={c.name}
                    style={{ width: 20, height: 20, borderRadius: "50%", border: activeColor === i ? `2.5px solid ${c.border}` : "2px solid #d4d0c8", background: c.bg, cursor: "pointer", transition: "all 0.15s", transform: activeColor === i ? "scale(1.15)" : "scale(1)" }} />
                ))}
                <span style={{ fontSize: 11, fontFamily: MONO, opacity: 0.3, marginLeft: 8 }}>select text to highlight (overlaps OK)</span>
              </div>
              <div ref={textRef} onMouseUp={handleSelect}
                style={{ padding: 24, background: "#fff", border: "1px solid #d4d0c8", borderRadius: 10, fontSize: 15, lineHeight: 1.85, minHeight: 400, whiteSpace: "pre-wrap", cursor: "text", userSelect: "text" }}>
                {doc ? renderText() : <span style={{ opacity: 0.3, fontStyle: "italic" }}>Switch to Edit mode first.</span>}
              </div>
            </div>
          )}

          {/* Overlap picker popover */}
          {overlapPicker && (
            <div style={{
              position: "fixed", left: overlapPicker.x, top: overlapPicker.y + 8, zIndex: 50,
              background: "#fff", border: "1px solid #d4d0c8", borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.12)", padding: 4, minWidth: 150,
            }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: "4px 8px", fontSize: 10, fontFamily: MONO, opacity: 0.4, textTransform: "uppercase" }}>Select annotation</div>
              {overlapPicker.ids.map(id => {
                const a = annotations.find(x => x.id === id);
                if (!a) return null;
                const idx = annotations.indexOf(a);
                const c = COLORS[a.color];
                return (
                  <button key={id} onClick={() => { setSelectedId(id); setInputText(""); setOverlapPicker(null); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 8px",
                      border: "none", background: selectedId === id ? c.bg : "transparent",
                      borderRadius: 4, cursor: "pointer", fontFamily: MONO, fontSize: 11, textAlign: "left",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = c.bg}
                    onMouseLeave={e => e.currentTarget.style.background = selectedId === id ? c.bg : "transparent"}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.border, flexShrink: 0 }} />
                    <span>{a.name || `#${idx + 1}`}</span>
                    <span style={{ opacity: 0.4, marginLeft: "auto" }}>{a.text.slice(0, 25)}…</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Side pane */}
        {mode === "annotate" && (
          <div data-tutorial="sidebar" style={{ width: 370, minWidth: 300, borderLeft: "1px solid #e5e2db", background: "#fff", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #e5e2db", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 500, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {currentAnno ? "Annotation" : `${annotations.length} annotation${annotations.length !== 1 ? "s" : ""}`}
              </span>
              {currentAnno && (
                <button onClick={() => setSelectedId(null)} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid #d4d0c8", background: "transparent", fontSize: 11, fontFamily: MONO, cursor: "pointer", opacity: 0.6 }}>← All</button>
              )}
            </div>

            {currentAnno ? (() => {
              const c = COLORS[currentAnno.color];
              const showCmdHints = inputText.startsWith("/") && !annoMention;
              const filteredCmds = showCmdHints ? cmdHints.filter(h => h.cmd.startsWith(inputText.split(" ")[0])) : [];
              const annoIdx = annotations.indexOf(currentAnno);
              return (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                  {/* Highlighted passage + name */}
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e2db", background: c.bg, flexShrink: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      {/* Annotation name (double-click to rename) */}
                      {renamingId === currentAnno.id ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <input value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") renameAnno(currentAnno.id, renameDraft.trim()); if (e.key === "Escape") setRenamingId(null); }}
                            placeholder={`#${annoIdx + 1}`} autoFocus
                            style={{ padding: "2px 6px", fontFamily: MONO, fontSize: 11, border: `1px solid ${c.border}`, borderRadius: 4, outline: "none", width: 120, background: "#fff" }} />
                          <button onClick={() => renameAnno(currentAnno.id, renameDraft.trim())}
                            style={{ padding: "2px 6px", borderRadius: 3, border: "none", background: c.border, color: "#fff", fontSize: 10, fontFamily: MONO, cursor: "pointer" }}>✓</button>
                        </div>
                      ) : (
                        <span onDoubleClick={() => { setRenamingId(currentAnno.id); setRenameDraft(currentAnno.name); }}
                          title="Double-click to rename"
                          style={{ fontSize: 10, fontFamily: MONO, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer" }}>
                          {currentAnno.name || `#${annoIdx + 1}`} — Highlighted Passage
                        </span>
                      )}
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <MiniColorPicker current={currentAnno.color} onChange={(ci) => changeAnnoColor(currentAnno.id, ci)} />
                        <button onClick={() => deleteAnno(currentAnno.id)} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", fontSize: 10, fontFamily: MONO, cursor: "pointer", marginLeft: 4 }}>✕</button>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <p style={{ fontSize: 13, fontStyle: "italic", margin: 0, color: c.text, lineHeight: 1.6, maxHeight: 120, overflowY: "auto", flex: 1 }}>
                        "{currentAnno.text}"
                      </p>
                      <button onClick={() => scrollToAnno(currentAnno.id)} title="Jump to highlight in document"
                        style={{ padding: "3px 7px", borderRadius: 4, border: `1px solid ${c.border}40`, background: "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11, flexShrink: 0, opacity: 0.5, transition: "opacity 0.15s" }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.5}>
                        ⎈
                      </button>
                    </div>
                  </div>

                  {/* Branch switcher */}
                  {currentAnno.branches.length > 0 && (
                    <div style={{ padding: "6px 16px", borderBottom: "1px solid #e5e2db", display: "flex", gap: 4, alignItems: "center", flexShrink: 0, overflowX: "auto" }}>
                      <span style={{ fontSize: 10, fontFamily: MONO, opacity: 0.4, flexShrink: 0 }}>branch:</span>
                      <button onClick={() => switchBranch(currentAnno.id, -1)}
                        style={{
                          padding: "2px 8px", borderRadius: 4, border: `1px solid ${currentAnno.activeBranch === -1 ? c.border : "#d4d0c8"}`,
                          background: currentAnno.activeBranch === -1 ? c.bg : "transparent",
                          fontSize: 10, fontFamily: MONO, cursor: "pointer", flexShrink: 0, fontWeight: currentAnno.activeBranch === -1 ? 600 : 400,
                        }}>
                        current
                      </button>
                      {currentAnno.branches.map((b, bi) => (
                        <button key={bi} onClick={() => switchBranch(currentAnno.id, bi)}
                          title={b.createdAt ? new Date(b.createdAt).toLocaleString() : ""}
                          style={{
                            padding: "2px 8px", borderRadius: 4, border: `1px solid ${currentAnno.activeBranch === bi ? c.border : "#d4d0c8"}`,
                            background: currentAnno.activeBranch === bi ? c.bg : "transparent",
                            fontSize: 10, fontFamily: MONO, cursor: "pointer", flexShrink: 0, fontWeight: currentAnno.activeBranch === bi ? 600 : 400,
                          }}>
                          v{bi + 1}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Attachments bar */}
                  {(currentAnno.attachments || []).length > 0 && (
                    <div style={{ padding: "6px 16px", borderBottom: "1px solid #e5e2db", display: "flex", gap: 4, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontFamily: MONO, opacity: 0.4, flexShrink: 0 }}>📎</span>
                      {currentAnno.attachments.map((att, ai) => (
                        <span key={ai} title={`${att.name} — ${(att.content.length / 1024).toFixed(1)}KB\nAttached ${new Date(att.addedAt).toLocaleString()}`}
                          style={{ padding: "2px 6px", borderRadius: 4, background: "#f7f6f3", border: "1px solid #e5e2db", fontSize: 10, fontFamily: MONO }}>
                          {att.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Thread */}
                  <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    {isViewingBranch && (
                      <div style={{ padding: "4px 8px", background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 6, fontSize: 10, fontFamily: MONO, textAlign: "center", opacity: 0.7 }}>
                        Viewing branch v{currentAnno.activeBranch + 1}
                      </div>
                    )}
                    {currentThread.length === 0 && loadingId !== currentAnno.id && (
                      <p style={{ fontSize: 12, opacity: 0.3, fontStyle: "italic", textAlign: "center", margin: "20px 0", lineHeight: 1.6 }}>
                        {HINTS[hintIdx]}
                      </p>
                    )}
                    {currentThread.map((msg, idx) => {
                      const isUser = msg.role === "user";
                      const isComment = msg.isComment;
                      const isEditing = editingNote?.annoId === currentAnno.id && editingNote?.msgIdx === idx;
                      return (
                        <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2, padding: "0 4px" }}>
                            <span style={{ fontSize: 10, fontFamily: MONO, opacity: 0.35 }}>
                              {isComment ? "💬" : ""} {msg.author || (isUser ? "You" : "Claude")}
                            </span>
                            {msg.withContext && !isComment && <span style={{ fontSize: 8, fontFamily: MONO, opacity: 0.3, background: "#DBEAFE", padding: "0 3px", borderRadius: 2 }}>ctx</span>}
                            {msg.timestamp && <span style={{ fontSize: 9, fontFamily: MONO, opacity: 0.25 }}>{formatTime(msg.timestamp)}</span>}
                            {msg.editedAt && <span style={{ fontSize: 9, fontFamily: MONO, opacity: 0.2 }}>(edited)</span>}
                          </div>
                          {isEditing ? (
                            <div style={{ width: "100%" }}>
                              <textarea value={editText} onChange={e => setEditText(e.target.value)}
                                style={{ width: "100%", minHeight: 50, padding: 8, fontFamily: FONT, fontSize: 13, border: `1px solid ${c.border}`, borderRadius: 8, resize: "vertical", background: "#fff", outline: "none", boxSizing: "border-box", lineHeight: 1.5 }} />
                              <div style={{ display: "flex", gap: 4, marginTop: 4, justifyContent: "flex-end" }}>
                                <button onClick={() => setEditingNote(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #d4d0c8", background: "transparent", fontSize: 10, fontFamily: MONO, cursor: "pointer" }}>Cancel</button>
                                <button onClick={() => saveEditSimple(currentAnno.id, idx)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#666", color: "#fff", fontSize: 10, fontFamily: MONO, cursor: "pointer" }}>Save</button>
                                {isUser && !isComment && (
                                  <button onClick={() => saveEditBranch(currentAnno.id, idx)}
                                    title="Save edit + create branch + regenerate AI response"
                                    style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: c.border, color: "#fff", fontSize: 10, fontFamily: MONO, cursor: "pointer" }}>
                                    Branch + Regen
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div style={{
                              padding: "8px 12px", borderRadius: 10, maxWidth: "95%",
                              background: isComment ? "#FEF9C3" : isUser ? c.border + "15" : msg.isError ? "#FEF2F2" : "#f7f6f3",
                              border: `1px solid ${isComment ? "#FCD34D" : isUser ? c.border + "30" : msg.isError ? "#FECACA" : "#e8e6e1"}`,
                              borderLeft: isComment ? "3px solid #F59E0B" : msg.isError ? "3px solid #F87171" : undefined,
                            }}>
                              <p style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                                <MessageContent content={msg.content} annotations={annotations} onNavigate={(id) => { setSelectedId(id); setInputText(""); }} />
                              </p>
                              <div style={{ display: "flex", gap: 4, marginTop: 5, alignItems: "center" }}>
                                  {msg.isError && (
                                    <button onClick={() => { setSettingsDraft(aiSettings || { provider: "anthropic", apiKey: "", model: PROVIDERS[0].defaultModel, baseUrl: "" }); setSettingsStatus(""); setShowSettings(true); }}
                                      style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid #FECACA", background: "#FEE2E2", fontSize: 10, fontFamily: MONO, cursor: "pointer", color: "#b91c1c" }}>
                                      ⚙️ Open Settings
                                    </button>
                                  )}
                                  <button onClick={() => { setEditingNote({ annoId: currentAnno.id, msgIdx: idx }); setEditText(msg.content); }}
                                    style={{ padding: "1px 6px", borderRadius: 3, border: "none", background: "transparent", fontSize: 10, fontFamily: MONO, cursor: "pointer", opacity: 0.2, transition: "opacity 0.15s" }}
                                    onMouseEnter={e => e.target.style.opacity = 0.6} onMouseLeave={e => e.target.style.opacity = 0.2}>edit</button>
                                  <button onClick={() => deleteMessage(currentAnno.id, idx)}
                                    style={{ padding: "1px 6px", borderRadius: 3, border: "none", background: "transparent", fontSize: 10, fontFamily: MONO, cursor: "pointer", opacity: 0.2, color: "#b91c1c", transition: "opacity 0.15s" }}
                                    onMouseEnter={e => e.target.style.opacity = 0.6} onMouseLeave={e => e.target.style.opacity = 0.2}>delete</button>
                                </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {loadingId === currentAnno.id && (
                      <div style={{ alignSelf: "flex-start", padding: "8px 12px", borderRadius: 10, background: "#f7f6f3", border: "1px solid #e8e6e1" }}>
                        <span style={{ fontSize: 13, fontFamily: MONO, opacity: 0.5, animation: "pulse 1.5s infinite" }}>Thinking…</span>
                        <style>{`@keyframes pulse { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }`}</style>
                      </div>
                    )}
                    <div ref={threadEndRef} />
                  </div>

                  {/* Command hints */}
                  {showCmdHints && filteredCmds.length > 0 && (
                    <div style={{ padding: "6px 16px", borderTop: "1px solid #f0ede8", background: "#faf9f6", flexShrink: 0 }}>
                      <div style={{ fontSize: 10, fontFamily: MONO, opacity: 0.35, marginBottom: 4 }}>↑↓ navigate · ↵/Tab select</div>
                      {filteredCmds.map((h, i) => (
                        <div key={h.cmd} onClick={() => { setInputText(h.cmd + " "); inputRef.current?.focus(); }}
                          onMouseEnter={() => setCmdHintIdx(i)}
                          style={{ padding: "4px 8px", fontSize: 11, fontFamily: MONO, cursor: "pointer", display: "flex", gap: 8, borderRadius: 4, background: i === cmdHintIdx ? c.bg : "transparent", transition: "background 0.1s" }}>
                          <span style={{ color: c.border, fontWeight: 500 }}>{h.cmd}</span>
                          <span style={{ opacity: 0.4 }}>{h.desc}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Annotation mention autocomplete */}
                  {annoMention && (
                    <div style={{ padding: "6px 16px", borderTop: "1px solid #f0ede8", background: "#faf9f6", flexShrink: 0, maxHeight: 160, overflowY: "auto" }}>
                      <div style={{ fontSize: 10, fontFamily: MONO, opacity: 0.35, marginBottom: 4 }}>Link annotation — ↵ select · Tab select with context (+) · Esc dismiss</div>
                      {annoMention.items.map((item, i) => {
                        const ac = COLORS[item.anno.color];
                        const isHighlighted = i === annoMentionIdx;
                        return (
                          <div key={item.anno.id}
                            onClick={() => insertAnnoMention(item)}
                            onMouseEnter={() => setAnnoMentionIdx(i)}
                            style={{
                              padding: "5px 8px", fontSize: 12, fontFamily: MONO, cursor: "pointer", display: "flex", gap: 8, alignItems: "center",
                              borderRadius: 4, background: isHighlighted ? ac.bg : "transparent", transition: "background 0.1s",
                            }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: ac.border, flexShrink: 0 }} />
                            <span style={{ fontWeight: 500, color: ac.border }}>@#{item.idx + 1}</span>
                            <span style={{ opacity: 0.5, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.anno.name || `"${item.anno.text.slice(0, 50)}${item.anno.text.length > 50 ? "…" : ""}"`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Input */}
                  <div style={{ padding: "10px 16px 14px", borderTop: "1px solid #e5e2db", flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                      <AutoTextarea inputRef={inputRef} value={inputText} onChange={e => setInputText(e.target.value)}
                        onKeyDown={e => {
                          if (annoMention) {
                            const items = annoMention.items;
                            if (e.key === "ArrowDown") { e.preventDefault(); setAnnoMentionIdx(i => (i + 1) % items.length); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); setAnnoMentionIdx(i => (i - 1 + items.length) % items.length); }
                            else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); insertAnnoMention(items[annoMentionIdx]); }
                            else if (e.key === "Tab") { e.preventDefault(); insertAnnoMention(items[annoMentionIdx], true); }
                            else if (e.key === "Escape") { e.preventDefault(); setInputText(inputText.slice(0, annoMention.startPos) + inputText.slice(annoMention.startPos + annoMention.fullMatch.length)); }
                            return;
                          }
                          if (showCmdHints && filteredCmds.length > 0) {
                            if (e.key === "ArrowDown") { e.preventDefault(); setCmdHintIdx(i => (i + 1) % filteredCmds.length); return; }
                            if (e.key === "ArrowUp") { e.preventDefault(); setCmdHintIdx(i => (i - 1 + filteredCmds.length) % filteredCmds.length); return; }
                            if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); setInputText(filteredCmds[cmdHintIdx].cmd + " "); inputRef.current?.focus(); return; }
                          }
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(currentAnno.id); }
                        }}
                        placeholder="" />
                      <button onClick={() => sendMessage(currentAnno.id)}
                        disabled={!inputText.trim() || loadingId === currentAnno.id}
                        style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: inputText.trim() ? c.border : "#ddd", color: "#fff", fontFamily: MONO, fontSize: 12, cursor: inputText.trim() ? "pointer" : "default", transition: "all 0.15s", flexShrink: 0, marginBottom: 1 }}>↵</button>
                    </div>
                  </div>
                </div>
              );
            })() : (
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
                {annotations.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 20 }}>
                    <p style={{ fontSize: 13, opacity: 0.4, lineHeight: 1.7, fontStyle: "italic", transition: "opacity 0.3s" }}>
                      {HINTS[hintIdx]}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {annotations.map((a, i) => {
                      const c = COLORS[a.color];
                      const qCount = a.thread.filter(m => m.role === "user").length;
                      return (
                        <div key={a.id} onClick={() => { setSelectedId(a.id); setInputText(""); }}
                          style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e2db", cursor: "pointer", transition: "all 0.15s", background: "#fff" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = c.border} onMouseLeave={e => e.currentTarget.style.borderColor = "#e5e2db"}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.border, flexShrink: 0 }} />
                            <span style={{ fontSize: 11, fontFamily: MONO, opacity: 0.4 }}>{getAnnoLabel(a, i)}</span>
                            {a.branches.length > 0 && <span style={{ fontSize: 9, fontFamily: MONO, opacity: 0.3 }}>🌿{a.branches.length}</span>}
                            {qCount > 0 && <span style={{ fontSize: 10, fontFamily: MONO, opacity: 0.4, marginLeft: "auto" }}>💬 {qCount}</span>}
                          </div>
                          <p style={{ fontSize: 12, margin: 0, fontStyle: "italic", opacity: 0.65, lineHeight: 1.4 }}>
                            "{a.text.length > 80 ? a.text.slice(0, 80) + "…" : a.text}"
                          </p>
                          {a.thread.length > 0 && (
                            <p style={{ fontSize: 11, margin: "5px 0 0", color: c.text, lineHeight: 1.4, fontFamily: MONO, opacity: 0.7 }}>
                              {a.thread[a.thread.length - 1].isComment ? "💬" : a.thread[a.thread.length - 1].role === "assistant" ? "A:" : "Q:"} {a.thread[a.thread.length - 1].content.slice(0, 60)}{a.thread[a.thread.length - 1].content.length > 60 ? "…" : ""}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tutorial overlay */}
      {tutorialStep !== null && (() => {
        const step = TUTORIAL_STEPS[tutorialStep];
        const pad = 8;
        const hasTarget = tutorialRect !== null;
        // Clip-path: full screen with a rectangular hole cut out around the target
        const clipPath = hasTarget
          ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${tutorialRect.left - pad}px ${tutorialRect.top - pad}px, ${tutorialRect.left - pad}px ${tutorialRect.top + tutorialRect.height + pad}px, ${tutorialRect.left + tutorialRect.width + pad}px ${tutorialRect.top + tutorialRect.height + pad}px, ${tutorialRect.left + tutorialRect.width + pad}px ${tutorialRect.top - pad}px, ${tutorialRect.left - pad}px ${tutorialRect.top - pad}px)`
          : undefined;
        // Position popup near target or centered
        const isMobile = window.innerWidth < 600;
        const popupW = isMobile ? window.innerWidth - 32 : 340;
        const POPUP_H = 220; // estimated height
        const popupStyle = hasTarget ? (() => {
          // If target covers >30% of viewport, center the popup instead
          const targetArea = tutorialRect.width * tutorialRect.height;
          const viewportArea = window.innerWidth * window.innerHeight;
          if (targetArea > viewportArea * 0.3 || isMobile) {
            return {
              position: "fixed", zIndex: 9999,
              top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              width: popupW,
            };
          }
          const below = tutorialRect.top + tutorialRect.height + pad + 12;
          const above = tutorialRect.top - pad - 12 - POPUP_H;
          const fitsBelow = below + POPUP_H < window.innerHeight - 16;
          const top = Math.max(16, fitsBelow ? below : above);
          const left = Math.max(16, Math.min(tutorialRect.left, window.innerWidth - popupW - 16));
          return { position: "fixed", zIndex: 9999, top, left, width: popupW };
        })() : {
          position: "fixed", zIndex: 9999,
          top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: popupW,
        };
        const isLast = tutorialStep === TUTORIAL_STEPS.length - 1;
        return (
          <>
            {/* Backdrop */}
            <div onClick={dismissTutorial} style={{
              position: "fixed", inset: 0, zIndex: 9998,
              background: "rgba(0,0,0,0.45)",
              clipPath,
              transition: "clip-path 0.3s ease",
            }} />
            {/* Spotlight border ring */}
            {hasTarget && (
              <div style={{
                position: "fixed", zIndex: 9998,
                top: tutorialRect.top - pad, left: tutorialRect.left - pad,
                width: tutorialRect.width + pad * 2, height: tutorialRect.height + pad * 2,
                borderRadius: 8, border: "2px solid rgba(255,255,255,0.6)",
                pointerEvents: "none", transition: "all 0.3s ease",
              }} />
            )}
            {/* Popup card */}
            <div style={{
              ...popupStyle,
              background: "#fff", borderRadius: isMobile ? 16 : 12, padding: isMobile ? "20px 20px" : "20px 24px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
              fontFamily: FONT, boxSizing: "border-box",
            }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>{step.title}</h3>
              <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.6, color: "#444", opacity: 0.85 }}>{step.body}</p>
              {/* Step dots */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16, justifyContent: "center" }}>
                {TUTORIAL_STEPS.map((_, i) => (
                  <span key={i} style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: i === tutorialStep ? COLORS[i % COLORS.length].border : "#d4d0c8",
                    transition: "background 0.2s",
                  }} />
                ))}
              </div>
              {/* Navigation buttons */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button onClick={dismissTutorial}
                  style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d4d0c8", background: "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11, opacity: 0.6 }}>
                  Skip
                </button>
                <div style={{ display: "flex", gap: 6 }}>
                  {tutorialStep > 0 && (
                    <button onClick={() => setTutorialStep(s => s - 1)}
                      style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d4d0c8", background: "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
                      Back
                    </button>
                  )}
                  <button onClick={() => isLast ? dismissTutorial() : setTutorialStep(s => s + 1)}
                    style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#1a1a1a", color: "#fff", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
                    {isLast ? "Done" : "Next"}
                  </button>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
