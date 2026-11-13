import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, MicOff, Square, X } from "lucide-react";
import type { BridgeRef } from "../lib/ai/bridge";
import { AgentError, runTurn, type AiMessage, type Provider } from "../lib/ai/agent";
import { listenOnce, speak, speechInputSupported, speechOutputSupported, stopSpeaking, type ListenHandle } from "../lib/ai/voice";
import { bindAnnotations } from "../lib/ai/annotations";
import { PROVIDERS, ProviderLogo } from "./ai/BrandLogos";
import "./ai/ai-bar.css";

interface Status {
  gemini: { configured: boolean; defaultModel: string; models: string[] };
  openai: { local: boolean; oauth: { signedIn: boolean; email: string | null }; apiKey: boolean; models: string[] };
  groq?: { configured: boolean; defaultModel: string; models: string[] };
}

interface Exchange {
  prompt: string;
  reply?: string;
  error?: boolean;
}

type Mode = "idle" | "listening" | "thinking" | "speaking";

const PREFS_KEY = "worldview.ai.prefs";

const ACTIVITY: Record<string, string> = {
  fly_to: "Flying", set_camera: "Moving camera", zoom_out_globe: "Zooming out", orbit: "Orbiting", frame_results: "Framing",
  track_entity: "Tracking", select_entity: "Selecting", fly_route: "Flying route", set_vision_mode: "Switching sensor",
  toggle_panel: "Opening panel", set_infrastructure_layer: "Toggling layer", annotate_place: "Annotating", draw_pin: "Dropping pin",
  draw_route: "Drawing route", measure_distance: "Measuring", draw_circle: "Drawing ring", draw_polygon: "Outlining",
  query_aircraft: "Checking aircraft", query_ships: "Checking ships", query_satellites: "Checking satellites",
  query_infrastructure: "Checking infrastructure", query_hazards: "Checking hazards", query_launches: "Checking launches",
  query_cctv: "Checking cameras", inspect_selected: "Inspecting", describe_view: "Reading the view", capture_view: "Looking",
};

function readPrefs(): { provider: Provider; geminiModel: string; openaiModel: string; groqModel: string; speakOn: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    const provider: Provider = p.provider === "openai" || p.provider === "groq" ? p.provider : "gemini";
    return { provider, geminiModel: p.geminiModel ?? "", openaiModel: p.openaiModel ?? "", groqModel: p.groqModel ?? "", speakOn: p.speakOn !== false };
  } catch {
    return { provider: "gemini", geminiModel: "", openaiModel: "", groqModel: "", speakOn: true };
  }
}

export function AiCopilot({ bridgeRef, base }: { bridgeRef: BridgeRef; base: string }) {
  const prefs = useRef(readPrefs()).current;
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>(prefs.provider);
  const [models, setModels] = useState({ gemini: prefs.geminiModel, openai: prefs.openaiModel, groq: prefs.groqModel });
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [speakOn, setSpeakOn] = useState(prefs.speakOn && speechOutputSupported());
  const [handsFree, setHandsFree] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [activity, setActivity] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);

  const historyRef = useRef<AiMessage[]>([]);
  const listenRef = useRef<ListenHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;
  const busyRef = useRef(false);

  const model = models[provider];
  const mode: Mode = listening ? "listening" : busy ? "thinking" : speaking ? "speaking" : "idle";

  useEffect(() => {
    bindAnnotations(bridgeRef.current?.map ?? null);
  });

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ provider, geminiModel: models.gemini, openaiModel: models.openai, groqModel: models.groq, speakOn }));
  }, [provider, models, speakOn]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const refreshStatus = useCallback(async () => {
    // The status call can land while the preview is still waking up; retry briefly.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(`${base}/api/ai/status`);
        if (r.ok) {
          const s = (await r.json()) as Status;
          if (s?.gemini) {
            setStatus(s);
            return;
          }
        }
      } catch { /* not reachable yet */ }
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }, [base]);

  const loadOpenaiModels = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/ai/openai/models`);
      const j = (await r.json()) as { models: string[] };
      setOpenaiModels(j.models ?? []);
    } catch { /* ignore */ }
  }, [base]);

  const toggleOpen = useCallback((next?: boolean) => {
    setOpen((o) => {
      const v = next ?? !o;
      if (v) {
        void refreshStatus();
        setTimeout(() => inputRef.current?.focus(), 50);
      } else {
        setMenuOpen(false);
      }
      return v;
    });
  }, [refreshStatus]);

  const startListening = useCallback(() => {
    if (listenRef.current || !speechInputSupported()) return;
    stopSpeaking();
    setSpeaking(false);
    setListening(true);
    setInterim("");
    listenRef.current = listenOnce(
      {
        onInterim: setInterim,
        onFinal: (t) => {
          setInterim("");
          void submitRef.current(t);
        },
        onError: (e) => {
          if (e !== "no-speech" && e !== "aborted") {
            setExchange({ prompt: "", reply: e.startsWith("Microphone") || e.startsWith("No microphone") ? e : `Microphone error: ${e}`, error: true });
          }
        },
        onEnd: () => {
          listenRef.current = null;
          setListening(false);
          setInterim("");
        },
      },
      base
    );
    if (!listenRef.current) setListening(false);
  }, [base]);

  const stopListening = useCallback(() => {
    listenRef.current?.stop();
  }, []);

  const say = useCallback(async (text: string) => {
    setSpeaking(true);
    try { await speak(text); } finally { setSpeaking(false); }
  }, []);

  const submit = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setInput("");
    setActivity("");
    setMenuOpen(false);
    stopSpeaking();
    setExchange({ prompt: text });
    try {
      const res = await runTurn({
        text,
        history: historyRef.current,
        provider,
        model: model || undefined,
        bridgeRef,
        base,
        onEvent: (e) => {
          if (e.type === "tool") setActivity(ACTIVITY[e.name] ?? "Working");
        },
      });
      historyRef.current = res.history;
      setExchange({ prompt: text, reply: res.reply });
      if (speakOn) await say(res.reply);
    } catch (e) {
      const err = e as AgentError;
      if (err.retryAfterSec) setCooldownUntil(Date.now() + err.retryAfterSec * 1000);
      const message = err.retryAfterSec
        ? `Rate limited. Try again in ${err.retryAfterSec}s, or switch provider.`
        : typeof err?.message === "string" && err.message ? err.message : "That request failed. Try again in a moment.";
      setExchange({ prompt: text, reply: message, error: true });
      void refreshStatus();
      if (speakOn) void say(err.retryAfterSec ? "I'm rate limited. Try again shortly." : "That request failed.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setActivity("");
      if (handsFreeRef.current) setTimeout(() => startListening(), 250);
    }
  }, [base, bridgeRef, model, provider, refreshStatus, say, speakOn, startListening]);

  const submitRef = useRef(submit);
  submitRef.current = submit;

  // Global hotkeys: "/" opens + focuses, "`" toggles the mic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); toggleOpen(true); }
      else if (e.key === "`") {
        e.preventDefault();
        if (!open) toggleOpen(true);
        if (listenRef.current) stopListening(); else startListening();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, startListening, stopListening, toggleOpen]);

  const close = () => {
    stopListening();
    stopSpeaking();
    setSpeaking(false);
    setHandsFree(false);
    toggleOpen(false);
  };

  const chooseProvider = (p: Provider) => {
    setProvider(p);
    historyRef.current = [];
    if (p === "openai") void loadOpenaiModels();
    void refreshStatus();
  };

  const providerName = PROVIDERS.find((p) => p.id === provider)?.name ?? "AI";

  if (!open) {
    return (
      <button type="button" className="ai-launcher ai-glass" onClick={() => toggleOpen(true)} aria-label={`Ask ${providerName} (press /)`}>
        <ProviderLogo provider={provider} size={16} />
        Ask anything
        <kbd>/</kbd>
      </button>
    );
  }

  const openaiReady = !!status && (status.openai.apiKey || (status.openai.local && status.openai.oauth.signedIn));
  const providerReady =
    provider === "gemini" ? !!status?.gemini.configured : provider === "groq" ? !!status?.groq?.configured : openaiReady;
  const modelOptions =
    provider === "gemini" ? status?.gemini.models ?? []
    : provider === "groq" ? status?.groq?.models ?? []
    : openaiModels.length ? openaiModels : status?.openai.models ?? [];
  const defaultModel =
    provider === "gemini" ? status?.gemini.defaultModel : provider === "groq" ? status?.groq?.defaultModel : modelOptions[0];

  const providerNote = !status ? null
    : provider === "gemini" && !status.gemini.configured ? { warn: true, text: "GEMINI_KEY is not set on the server." }
    : provider === "groq" && !status.groq?.configured ? { warn: true, text: "GROQ_API is not set on the server." }
    : provider === "groq" ? { warn: false, text: "Text only. Groq can't see the map view." }
    : provider === "openai" && !openaiReady && !status.openai.local ? { warn: true, text: "Set OPENAI_API_KEY on the server to use OpenAI here." }
    : null;

  const shownPrompt = listening ? interim : exchange?.prompt;
  const thinkingText = activity ? `${activity}…` : "Thinking…";
  const cooling = cooldownUntil > Date.now();

  return (
    <section aria-label={`${providerName} assistant`} className="ai-root" onKeyDown={(e) => e.stopPropagation()}>
      {(exchange || (listening && interim)) && (
        <div className="ai-reply ai-glass" aria-live="polite">
          {shownPrompt && <p className="ai-reply-you">{shownPrompt}</p>}
          {!listening && (busy ? (
            <p className="ai-reply-text ai-thinking">{thinkingText}</p>
          ) : exchange?.reply ? (
            <p className="ai-reply-text" data-error={exchange.error ? "true" : undefined} role={exchange.error ? "alert" : undefined}>
              {exchange.reply}
            </p>
          ) : null)}
          {!busy && !listening && (
            <button type="button" className="ai-icon-btn ai-small ai-dismiss" onClick={() => setExchange(null)} aria-label="Dismiss reply">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <div ref={menuRef} style={{ position: "relative" }}>
        {menuOpen && (
          <div className="ai-menu ai-glass" role="dialog" aria-label="Assistant settings">
            <div className="ai-provider-row" role="group" aria-label="Model provider">
              {PROVIDERS.map(({ id, name, Logo }) => (
                <button key={id} type="button" className="ai-provider" aria-pressed={provider === id} aria-label={name} title={name} onClick={() => chooseProvider(id)}>
                  <Logo size={20} />
                </button>
              ))}
            </div>

            {modelOptions.length > 0 && (
              <label>
                <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Model</span>
                <select
                  value={model || defaultModel || ""}
                  onChange={(e) => setModels((m) => ({ ...m, [provider]: e.target.value }))}
                >
                  {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            )}

            {providerNote && <p className="ai-note" data-warn={providerNote.warn ? "true" : undefined}>{providerNote.text}</p>}

            {provider === "openai" && status?.openai.local && (
              status.openai.oauth.signedIn ? (
                <p className="ai-note">
                  {status.openai.oauth.email ?? "Signed in"} ·{" "}
                  <button type="button" className="ai-link" onClick={async () => { await fetch(`${base}/api/ai/openai/logout`, { method: "POST" }); void refreshStatus(); }}>
                    Sign out
                  </button>
                </p>
              ) : (
                <button type="button" className="ai-link" style={{ alignSelf: "flex-start" }} onClick={() => { window.location.href = `${base}/api/ai/openai/login?return=${encodeURIComponent(window.location.href)}`; }}>
                  Sign in with ChatGPT
                </button>
              )
            )}

            <div>
              <button
                type="button"
                role="switch"
                className="ai-toggle"
                aria-checked={speakOn}
                disabled={!speechOutputSupported()}
                onClick={() => { if (speakOn) { stopSpeaking(); setSpeaking(false); } setSpeakOn((v) => !v); }}
              >
                Read replies aloud <span className="ai-switch" aria-hidden="true" />
              </button>
              <button
                type="button"
                role="switch"
                className="ai-toggle"
                aria-checked={handsFree}
                disabled={!speechInputSupported()}
                onClick={() => { const v = !handsFree; setHandsFree(v); if (v) startListening(); else stopListening(); }}
              >
                Hands-free conversation <span className="ai-switch" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        <div className="ai-shell" data-state={mode}>
          <form className="ai-pill" onSubmit={(e) => { e.preventDefault(); void submit(input); }}>
            <button
              type="button"
              className="ai-icon-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={`${providerName} settings`}
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
            >
              <ProviderLogo provider={provider} size={18} />
            </button>
            <label style={{ flex: 1, display: "flex", height: "100%", minWidth: 0 }}>
              <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Message {providerName}</span>
              <input
                ref={inputRef}
                className="ai-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault();
                  if (e.key === "Escape") close();
                }}
                placeholder={listening ? "Listening…" : cooling ? "Rate limited, try again shortly" : providerReady ? `Ask ${providerName}` : "Ask anything"}
                autoComplete="off"
              />
            </label>
            {input.trim() ? (
              <button type="submit" className="ai-icon-btn" data-active="true" disabled={busy} aria-label="Send">
                <ArrowUp size={18} />
              </button>
            ) : (
              <button
                type="button"
                className="ai-icon-btn"
                data-active={listening ? "true" : undefined}
                onClick={() => (listening ? stopListening() : startListening())}
                aria-label={listening ? "Stop listening" : "Talk (press `)"}
                aria-pressed={listening}
                disabled={!speechInputSupported()}
                title={speechInputSupported() ? "Talk ( ` )" : "Voice input isn't supported in this browser"}
              >
                {listening ? <Square size={14} fill="currentColor" /> : speechInputSupported() ? <Mic size={18} /> : <MicOff size={18} />}
              </button>
            )}
            <button type="button" className="ai-icon-btn" onClick={close} aria-label="Close assistant">
              <X size={16} />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
