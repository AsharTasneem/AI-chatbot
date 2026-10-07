"use client";

import { useState, useEffect, useRef } from "react";

// API Endpoint configured via .env
const API_ENDPOINT = process.env.API_KEY || "";


// Reusable configuration for 503 retry logic
const MAX_503_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

interface ResponseMetadata {
  latencyMs?: number;
  retrievedFactCount?: number;
  conversationId?: string;
}

export interface ChatExchange {
  id: string;
  userMessage: {
    text: string;
    timestamp: string;
    quotedText?: string;
  };
  aiResponse: {
    text: string;
    timestamp: string;
    isError?: boolean;
    metadata?: ResponseMetadata | null;
  } | null;
}

const EXAMPLE_PROMPTS = [
  "What services does Technyx offer?",
  "Tell me about Product & Platform Engineering",
  "What are Technyx's AI Consulting capabilities?",
];

// Reusable helper to parse the API response body dynamically without hardcoding
async function parseApiResponse(res: Response): Promise<{ data: any; message: string }> {
  try {
    const data = await res.json();
    let message = "";
    if (typeof data?.response === "string") {
      message = data.response;
    } else if (typeof data?.detail === "string") {
      message = data.detail;
    } else if (typeof data?.message === "string") {
      message = data.message;
    } else if (typeof data?.error === "string") {
      message = data.error;
    } else if (data?.detail && typeof data.detail === "object") {
      message = JSON.stringify(data.detail, null, 2);
    } else if (data) {
      message = JSON.stringify(data, null, 2);
    }
    return { data, message };
  } catch {
    const text = await res.text().catch(() => "");
    return { data: null, message: text };
  }
}

// Reusable request dispatcher preserving existing endpoint, method, headers, and 503 retries
// First message sends { message }
// Subsequent messages send { message, conversation_id }
async function sendChatRequest(
  message: string,
  conversationId?: string | null
): Promise<Response> {
  let attempt = 0;

  const requestBody: { message: string; conversation_id?: string } = {
    message,
  };

  // Only include conversation_id if one exists from a previous API response
  if (conversationId && conversationId.trim()) {
    requestBody.conversation_id = conversationId.trim();
  }

  while (true) {
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "technyxsystems",
      },
      body: JSON.stringify(requestBody),
    });

    // 503 Handling: Automatically retry if temporarily unavailable
    if (res.status === 503 && attempt < MAX_503_RETRIES) {
      attempt++;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      continue;
    }

    return res;
  }
}

export default function Home() {
  // Exchanges state: Up to 5 complete user + AI exchanges (10 messages total)
  const [exchanges, setExchanges] = useState<ChatExchange[]>([]);
  // conversation_id provided dynamically by API to maintain session context
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ChatGPT-style text selection & quoted context
  const [quotedContext, setQuotedContext] = useState<string | null>(null);
  const [selectionPrompt, setSelectionPrompt] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);

  // Inline editing state for user messages
  const [editingExchangeId, setEditingExchangeId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Synchronize conversation_id state and ref
  const updateConversationId = (newId: string | null) => {
    conversationIdRef.current = newId;
    setConversationId(newId);
  };

  // Auto-scroll conversation area to the bottom on new exchange or state change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [exchanges, isLoading]);

  // Loading elapsed timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setLoadingSeconds(0);
      interval = setInterval(() => {
        setLoadingSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  // Detect text selection on assistant responses to show floating "Ask Agent" action
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setSelectionPrompt(null);
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        setSelectionPrompt(null);
        return;
      }

      // Ensure selection is strictly inside an assistant response (.ai-bubble)
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
      const focusEl = focusNode instanceof Element ? focusNode : focusNode?.parentElement;

      const aiBubbleAnchor = anchorEl?.closest(".ai-bubble");
      const aiBubbleFocus = focusEl?.closest(".ai-bubble");

      // Only show if selection is within the same assistant bubble
      if (!aiBubbleAnchor || aiBubbleAnchor !== aiBubbleFocus) {
        setSelectionPrompt(null);
        return;
      }

      try {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          setSelectionPrompt(null);
          return;
        }

        // Position floating pill above the selection centered horizontally
        const top = Math.max(12, rect.top - 42);
        const left = Math.min(
          window.innerWidth - 130,
          Math.max(12, rect.left + rect.width / 2 - 50)
        );

        setSelectionPrompt({ text, top, left });
      } catch {
        setSelectionPrompt(null);
      }
    };

    const handleDismissFloating = () => {
      setSelectionPrompt(null);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("scroll", handleDismissFloating, true);
    window.addEventListener("resize", handleDismissFloating);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("scroll", handleDismissFloating, true);
      window.removeEventListener("resize", handleDismissFloating);
    };
  }, []);

  // Reusable robust copy to clipboard with fallback (copies pure message content only)
  const handleCopyMessage = async (id: string, textToCopy: string) => {
    if (!textToCopy) return;
    let copied = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        copied = true;
      }
    } catch {
      // Proceed to fallback
    }

    if (!copied) {
      try {
        const el = document.createElement("textarea");
        el.value = textToCopy;
        el.style.position = "fixed";
        el.style.left = "-9999px";
        el.style.top = "-9999px";
        document.body.appendChild(el);
        el.focus();
        el.select();
        copied = document.execCommand("copy");
        document.body.removeChild(el);
      } catch {
        copied = false;
      }
    }

    if (copied) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // "Ask Agent" action: adds selected text as quote context and focuses input
  const handleAskAgent = (selectedText: string) => {
    setQuotedContext(selectedText);
    setSelectionPrompt(null);
    window.getSelection()?.removeAllRanges();
    textareaRef.current?.focus();
  };

  // Reusable core request executor for new submissions and edits
  const executeChatRequest = async (
    messageToSend: string,
    targetExchangeId: string,
    activeConversationId: string | null
  ) => {
    setIsLoading(true);

    try {
      const res = await sendChatRequest(messageToSend, activeConversationId);
      const { data, message } = await parseApiResponse(res);

      if (data?.conversation_id && typeof data.conversation_id === "string") {
        updateConversationId(data.conversation_id);
      }

      let responseContent = "";
      let isError = false;
      let metadata: ResponseMetadata | null = null;

      switch (res.status) {
        case 200: {
          responseContent = message;
          if (data?.latency_ms || data?.retrieved_fact_count || data?.conversation_id) {
            metadata = {
              latencyMs: data.latency_ms,
              retrievedFactCount: data.retrieved_fact_count,
              conversationId: data.conversation_id,
            };
          }
          break;
        }
        case 401: {
          responseContent = message || "Unauthorized: Invalid or missing API key.";
          isError = true;
          break;
        }
        case 429: {
          responseContent = message || "Rate limit reached. Please try again later.";
          isError = true;
          break;
        }
        case 503: {
          responseContent = message || "Service temporarily unavailable. Please try again later.";
          isError = true;
          break;
        }
        default: {
          responseContent = message || `Request failed with status ${res.status}`;
          isError = true;
          break;
        }
      }

      const responseTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      setExchanges((prev) =>
        prev.map((item) =>
          item.id === targetExchangeId
            ? {
                ...item,
                aiResponse: {
                  text: responseContent,
                  timestamp: responseTime,
                  isError,
                  metadata,
                },
              }
            : item
        )
      );
    } catch (err: unknown) {
      const networkErrorMessage =
        err instanceof Error
          ? err.message
          : "Network error: Unable to connect to the server. Please check your connection.";

      const responseTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      setExchanges((prev) =>
        prev.map((item) =>
          item.id === targetExchangeId
            ? {
                ...item,
                aiResponse: {
                  text: networkErrorMessage,
                  timestamp: responseTime,
                  isError: true,
                },
              }
            : item
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Handle standard form submission
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading) return;

    const exchangeId = `exchange-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const timeString = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const activeQuoted = quotedContext;

    const newExchange: ChatExchange = {
      id: exchangeId,
      userMessage: {
        text: trimmedQuestion,
        timestamp: timeString,
        quotedText: activeQuoted || undefined,
      },
      aiResponse: null,
    };

    setExchanges((prev) => [...prev, newExchange]);

    setQuestion("");
    setQuotedContext(null);

    const messageToSend = activeQuoted
      ? `[Context: "${activeQuoted}"]\n${trimmedQuestion}`
      : trimmedQuestion;

    await executeChatRequest(messageToSend, exchangeId, conversationIdRef.current);
  };

  // Handle editing an existing user message
  const handleEditSubmit = async (exchangeId: string) => {
    const trimmed = editingText.trim();
    if (!trimmed || isLoading) return;

    const targetIndex = exchanges.findIndex((item) => item.id === exchangeId);
    if (targetIndex === -1) return;

    const targetExchange = exchanges[targetIndex];
    const timeString = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const existingQuoted = targetExchange.userMessage.quotedText;

    // Truncate subsequent exchanges following this turn to maintain conversation integrity
    const priorExchanges = exchanges.slice(0, targetIndex);
    const updatedExchange: ChatExchange = {
      ...targetExchange,
      userMessage: {
        text: trimmed,
        timestamp: timeString,
        quotedText: existingQuoted,
      },
      aiResponse: null, // Loading indicator active
    };

    setExchanges([...priorExchanges, updatedExchange]);
    setEditingExchangeId(null);

    // Identify active conversation_id prior to this turn
    const priorConversationId =
      targetIndex > 0
        ? priorExchanges[targetIndex - 1]?.aiResponse?.metadata?.conversationId || null
        : null;

    updateConversationId(priorConversationId);

    const messageToSend = existingQuoted
      ? `[Context: "${existingQuoted}"]\n${trimmed}`
      : trimmed;

    await executeChatRequest(messageToSend, exchangeId, priorConversationId);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePromptClick = (promptText: string) => {
    setQuestion(promptText.slice(0, 200));
    textareaRef.current?.focus();
  };

  // Reset conversation session & clear history, context, and conversation_id
  const handleNewChat = () => {
    setExchanges([]);
    updateConversationId(null);
    setQuestion("");
    setQuotedContext(null);
    setEditingExchangeId(null);
    setSelectionPrompt(null);
    textareaRef.current?.focus();
  };


  return (
    <div className="chat-app-root">
      {/* Full-Page Application Header */}
      <header className="chat-app-header">
        <div className="header-brand-group">
          <div className="brand-logo-badge" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
            </svg>
          </div>
          <div className="brand-text-block">
            <span className="brand-title">Technyx Systems AI</span>
            <div className="brand-status-row">
              <span className="status-dot-pulse" />
              <span>
                {conversationId ? "Active Session" : "Live Assistant"}
              </span>
            </div>
          </div>
        </div>

        <div className="header-controls">
          {/* <span className="exchange-counter-pill" title="Stored conversation exchanges">
            {exchanges.length} {exchanges.length === 1 ? "exchange" : "exchanges"}
          </span> */}

          <button
            type="button"
            className="new-chat-btn"
            onClick={handleNewChat}
            disabled={isLoading}
            title="Start a fresh conversation"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New Chat</span>
          </button>
        </div>
      </header>

      {/* Full-Page Scrollable Conversation Area */}
      <main className="chat-conversation-area" role="log" aria-live="polite">
        <div className="conversation-inner">
          {/* Welcome / Empty Hero State */}
          {exchanges.length === 0 && (
            <div className="chat-empty-hero">
              <div className="hero-icon-container" aria-hidden="true">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#818cf8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>

              <h1 className="hero-title">How can I help you today?</h1>
              <p className="hero-desc">
                Engage in an AI-powered conversation on Technyx engineering, cloud platforms, and architecture. Context is maintained across all conversation exchanges.
              </p>

              <div className="hero-prompt-grid">
                {EXAMPLE_PROMPTS.map((promptText, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="hero-prompt-card"
                    onClick={() => handlePromptClick(promptText)}
                  >
                    <span>{promptText}</span>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation Exchanges */}
          {exchanges.map((exchange) => (
            <div key={exchange.id} className="chat-turn-exchange">
              {/* User Message Row */}
              <div className="message-row user-row">
                <div className="message-wrapper">
                  <div className="message-meta-header">
                    {/* Action Toolbar for User Message: Copy & Edit */}
                    <div className="message-actions-group">
                      <button
                        type="button"
                        className={`msg-action-btn ${copiedId === `user-${exchange.id}` ? "copied" : ""}`}
                        onClick={() => handleCopyMessage(`user-${exchange.id}`, exchange.userMessage.text)}
                        title="Copy message"
                        aria-label="Copy message text"
                      >
                        {copiedId === `user-${exchange.id}` ? (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            <span>Copy</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        className="msg-action-btn"
                        onClick={() => {
                          setEditingExchangeId(exchange.id);
                          setEditingText(exchange.userMessage.text);
                        }}
                        disabled={isLoading}
                        title="Edit message"
                        aria-label="Edit user message"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                        <span>Edit</span>
                      </button>
                    </div>

                    <span>{exchange.userMessage.timestamp}</span>
                    <span className="message-sender-name">You</span>
                  </div>

                  {/* Inline Message Edit View or Regular Bubble */}
                  {editingExchangeId === exchange.id ? (
                    <div className="edit-message-box">
                      <textarea
                        className="edit-message-textarea"
                        value={editingText}
                        maxLength={200}
                        onChange={(e) => setEditingText(e.target.value.slice(0, 200))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleEditSubmit(exchange.id);
                          } else if (e.key === "Escape") {
                            setEditingExchangeId(null);
                          }
                        }}
                        rows={2}
                        autoFocus
                        disabled={isLoading}
                        aria-label="Edit your message"
                      />
                      <div className="edit-message-actions">
                        <span className="edit-char-count">{editingText.length} / 200</span>
                        <button
                          type="button"
                          className="edit-cancel-btn"
                          onClick={() => setEditingExchangeId(null)}
                          disabled={isLoading}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="edit-submit-btn"
                          onClick={() => handleEditSubmit(exchange.id)}
                          disabled={isLoading || !editingText.trim()}
                        >
                          Save &amp; Submit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="user-bubble">
                      {exchange.userMessage.quotedText && (
                        <div className="user-bubble-quote" title={exchange.userMessage.quotedText}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
                          </svg>
                          <span>{exchange.userMessage.quotedText}</span>
                        </div>
                      )}
                      <span>{exchange.userMessage.text}</span>
                    </div>
                  )}
                </div>

                <div className="message-avatar user-avatar" aria-hidden="true">
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
              </div>

              {/* AI Response Row */}
              <div className="message-row ai-row">
                <div className="message-avatar ai-avatar" aria-hidden="true">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
                  </svg>
                </div>

                <div className="message-wrapper">
                  <div className="message-meta-header">
                    <span className="message-sender-name">Technyx Assistant</span>
                    <span>
                      {exchange.aiResponse ? exchange.aiResponse.timestamp : "Responding..."}
                    </span>

                    {/* Action Toolbar for Assistant Message: Copy */}
                    {exchange.aiResponse && (
                      <div className="message-actions-group">
                        <button
                          type="button"
                          className={`msg-action-btn ${copiedId === `ai-${exchange.id}` ? "copied" : ""}`}
                          onClick={() => handleCopyMessage(`ai-${exchange.id}`, exchange.aiResponse!.text)}
                          title="Copy response"
                          aria-label="Copy assistant response"
                        >
                          {copiedId === `ai-${exchange.id}` ? (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* AI Finished Response or In-Feed Typing Indicator */}
                  {exchange.aiResponse ? (
                    <div
                      className={`ai-bubble ${
                        exchange.aiResponse.isError ? "error-bubble" : ""
                      }`}
                    >
                      {exchange.aiResponse.text}
                    </div>
                  ) : (
                    /* AI Modern Loading / Thinking State */
                    <div className="ai-thinking-box" aria-live="polite">
                      <div className="ai-thinking-header">
                        <span className="ai-thinking-indicator-dot" />
                        <span className="ai-thinking-text">Generating response...</span>
                        {loadingSeconds > 0 && (
                          <span className="ai-thinking-time">{loadingSeconds}s</span>
                        )}
                      </div>
                      <div className="ai-typing-dots" aria-hidden="true">
                        <span className="typing-dot dot-1" />
                        <span className="typing-dot dot-2" />
                        <span className="typing-dot dot-3" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Anchor for automatic smooth scrolling */}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Bottom Sticky Input Dock */}
      <footer className="chat-bottom-dock">
        <div className="dock-inner">
          {/* Quick prompt suggestions chips (visible when conversation is active) */}
          {exchanges.length > 0 && (
            <div className="dock-chips-bar">
              {EXAMPLE_PROMPTS.map((promptText, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="dock-chip-btn"
                  onClick={() => handlePromptClick(promptText)}
                  disabled={isLoading}
                >
                  {promptText}
                </button>
              ))}
            </div>
          )}

          {/* ChatGPT-Style Quoted Context Banner above Input */}
          {quotedContext && (
            <div className="quoted-context-dock" aria-label="Quoted text context">
              <div className="quoted-context-preview">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="quoted-icon"
                  aria-hidden="true"
                >
                  <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
                </svg>
                <span className="quoted-context-label">Context:</span>
                <span className="quoted-context-snippet" title={quotedContext}>
                  &ldquo;{quotedContext.length > 85 ? quotedContext.slice(0, 85) + "..." : quotedContext}&rdquo;
                </span>
              </div>
              <button
                type="button"
                className="quoted-context-clear-btn"
                onClick={() => setQuotedContext(null)}
                title="Remove quoted context"
                aria-label="Remove quoted context"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {/* Chat Input Box */}
          <form className="chat-input-box" onSubmit={handleSubmit}>
            <div className="chat-input-row">
              <textarea
                id="question-input"
                ref={textareaRef}
                className="question-textarea"
                placeholder={quotedContext ? "Ask a question about the selected text..." : "Ask Technyx Assistant anything..."}
                value={question}
                maxLength={200}
                onChange={(e) => setQuestion(e.target.value.slice(0, 200))}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={isLoading}
                aria-label="Ask your question"
              />

              <button
                type="submit"
                id="submit-ask-button"
                className="send-btn"
                disabled={isLoading || !question.trim()}
                aria-label="Send message"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>

            <div className="dock-footer-info">
              <span className="shortcut-hint">
                Press Enter to send &bull; Shift+Enter for new line
              </span>
              <span className="char-counter">{question.length} / 200</span>
            </div>
          </form>

          <div className="dock-disclaimer">
            Technyx AI Assistant &bull; Answers powered by Technyx Systems knowledge base
          </div>
        </div>
      </footer>

      {/* Floating "Ask Agent" Action on Text Selection */}
      {selectionPrompt && (
        <button
          type="button"
          className="ask-agent-floating-btn"
          style={{
            top: `${selectionPrompt.top}px`,
            left: `${selectionPrompt.left}px`,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleAskAgent(selectionPrompt.text)}
          title="Ask Agent about selected text"
          aria-label="Ask Agent about selected text"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
          </svg>
          <span>Ask Agent</span>
        </button>
      )}
    </div>
  );
}

