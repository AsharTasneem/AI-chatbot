"use client";

import { useState, useEffect, useRef } from "react";

// API Endpoint configured via .env
const API_ENDPOINT = process.env.API_KEY || "";

// Configurable limit: Exactly 5 user messages + 5 corresponding AI responses (10 chat messages total)
const MAX_CONVERSATION_MESSAGES = 5;

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

  // Handle form submission
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading) return;

    const exchangeId = `exchange-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const timeString = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    // New exchange with pending AI response
    const newExchange: ChatExchange = {
      id: exchangeId,
      userMessage: {
        text: trimmedQuestion,
        timestamp: timeString,
      },
      aiResponse: null, // Loading indicator active for this exchange
    };

    // Strictly enforce MAX_CONVERSATION_MESSAGES (5 user + 5 AI exchanges = 10 messages max)
    // When the 6th question is added, remove the oldest user message + AI response
    setExchanges((prev) => {
      const trimmed =
        prev.length >= MAX_CONVERSATION_MESSAGES
          ? prev.slice(prev.length - MAX_CONVERSATION_MESSAGES + 1)
          : prev;
      return [...trimmed, newExchange];
    });

    setQuestion("");
    setIsLoading(true);

    try {
      // Dispatch request with current conversation_id (null for first message, returned ID for subsequent messages)
      const activeConversationId = conversationIdRef.current;
      const res = await sendChatRequest(trimmedQuestion, activeConversationId);
      const { data, message } = await parseApiResponse(res);

      // Store or update conversation_id whenever returned by the API
      if (data?.conversation_id && typeof data.conversation_id === "string") {
        updateConversationId(data.conversation_id);
      }

      let responseContent = "";
      let isError = false;
      let metadata: ResponseMetadata | null = null;

      // Handle status codes while preserving existing error logic
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
          // 401: Render API returned error response without exposing API key
          responseContent = message || "Unauthorized: Invalid or missing API key.";
          isError = true;
          break;
        }

        case 429: {
          // 429: Render API returned rate limit message
          responseContent = message || "Rate limit reached. Please try again later.";
          isError = true;
          break;
        }

        case 503: {
          // 503: Service temporarily unavailable after retries
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

      // Update the exchange with the received AI response
      setExchanges((prev) =>
        prev.map((item) =>
          item.id === exchangeId
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
          item.id === exchangeId
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

  // Reset conversation session & clear history and conversation_id
  const handleNewChat = () => {
    setExchanges([]);
    updateConversationId(null);
    setQuestion("");
    textareaRef.current?.focus();
  };

  const handleCopyMessage = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Ignore clipboard write rejection
    }
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
          <span className="exchange-counter-pill" title="Stored exchanges (5 user + 5 AI responses maximum)">
            {exchanges.length} / {MAX_CONVERSATION_MESSAGES} exchanges
          </span>

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
                Engage in an AI-powered conversation on Technyx engineering, cloud platforms, and architecture. Context is maintained across up to {MAX_CONVERSATION_MESSAGES} exchanges.
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
                    <span className="message-sender-name">You</span>
                    <span>{exchange.userMessage.timestamp}</span>
                  </div>
                  <div className="user-bubble">{exchange.userMessage.text}</div>
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
                  </div>

                  {/* AI Finished Response or In-Feed Typing Indicator */}
                  {exchange.aiResponse ? (
                    <div
                      className={`ai-bubble ${
                        exchange.aiResponse.isError ? "error-bubble" : ""
                      }`}
                    >
                      {exchange.aiResponse.text}

                      {/* Bubble Footer: Latency/Fact metadata & copy button */}
                      
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

          {/* Chat Input Box */}
          <form className="chat-input-box" onSubmit={handleSubmit}>
            <div className="chat-input-row">
              <textarea
                id="question-input"
                ref={textareaRef}
                className="question-textarea"
                placeholder="Ask Technyx Assistant anything..."
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
    </div>
  );
}
