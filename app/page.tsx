"use client";

import { useState, useEffect } from "react";

const API_ENDPOINT = process.env.API_KEY || "";


interface ResponseMetadata {
  latencyMs?: number;
  retrievedFactCount?: number;
  conversationId?: string;
}

const EXAMPLE_PROMPTS = [
  "What services does Technyx offer?",
  "Tell me about Product & Platform Engineering",
  "What are Technyx's AI Consulting capabilities?",
];

// Reusable configuration for 503 retry logic
const MAX_503_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

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

// Reusable request dispatcher with automatic 503 retries
async function sendChatRequest(message: string): Promise<Response> {
  let attempt = 0;

  while (true) {
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "technyxsystems",
      },
      body: JSON.stringify({ message }),
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
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<ResponseMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Track elapsed loading seconds and cycling stages
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

  const getLoadingStageText = (seconds: number) => {
    if (seconds < 3) return "Analyzing query and intent...";
    if (seconds < 8) return "Scanning enterprise knowledge base for relevant facts...";
    if (seconds < 16) return "Synthesizing customized AI response...";
    return "Finalizing response from Technyx AI...";
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading) return;

    setIsLoading(true);
    setError(null);
    setResponse(null);
    setMetadata(null);

    try {
      const res = await sendChatRequest(trimmedQuestion);
      const { data, message } = await parseApiResponse(res);

      // Handle HTTP status codes separately
      switch (res.status) {
        case 200: {
          // Success: Render normal API response
          setResponse(message);
          if (data?.latency_ms || data?.retrieved_fact_count || data?.conversation_id) {
            setMetadata({
              latencyMs: data.latency_ms,
              retrievedFactCount: data.retrieved_fact_count,
              conversationId: data.conversation_id,
            });
          }
          break;
        }

        case 401: {
          // 401: API key is missing or incorrect. Render API response without exposing key.
          setResponse(message || "Unauthorized: Invalid or missing API key.");
          break;
        }

        case 429: {
          // 429: Rate limit reached. Render the API's returned response.
          setResponse(message || "Rate limit reached. Please try again later.");
          break;
        }

        case 503: {
          // 503: Service temporarily unavailable (all retries failed). Render final response.
          setResponse(message || "Service temporarily unavailable. Please try again later.");
          break;
        }

        default: {
          // Other HTTP errors: Render the API's returned response/error
          setResponse(message || `Request failed with status ${res.status}`);
          break;
        }
      }
    } catch (err: unknown) {
      // Safely handle network / connection failures
      const networkErrorMessage =
        err instanceof Error
          ? err.message
          : "Network error: Unable to connect to the server. Please check your connection.";
      setError(networkErrorMessage);
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

  const handleClear = () => {
    setQuestion("");
    setResponse(null);
    setMetadata(null);
    setError(null);
  };

  const handleCopy = async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failure
    }
  };

  return (
    <div className="chatbot-page">
      <div className="ambient-glow" />

      <main className="main-container">
        {/* Header Section */}
        <header className="header-section">
          <div className="brand-badge">
            <span className="badge-dot" />
            <span>Technyx Systems AI</span>
          </div>
          <h1 className="page-title">Enterprise Knowledge Assistant</h1>
          <p className="page-subtitle">
            Ask any question about Technyx services, platform engineering, and AI capabilities.
          </p>
        </header>

        {/* Interactive Chat Card */}
        <div className="chat-card">
          <form className="question-form" onSubmit={handleSubmit}>
            <div className="input-header">
              <label htmlFor="question-input" className="input-label">
                <span>Enter your question</span>
              </label>
              <span className="char-counter">{question.length} / 200</span>
            </div>

            <div className="input-wrapper">
              <textarea
                id="question-input"
                className="question-textarea"
                placeholder="What services does Technyx offer?"
                value={question}
                maxLength={200}
                onChange={(e) => setQuestion(e.target.value.slice(0, 200))}
                onKeyDown={handleKeyDown}
                rows={4}
                disabled={isLoading}
              />
            </div>

            {/* Quick Prompt Suggestions */}
            <div className="quick-prompts-wrapper">
              <span className="quick-prompts-label">Try asking:</span>
              <div className="quick-prompts-list">
                {EXAMPLE_PROMPTS.map((promptText, index) => (
                  <button
                    key={index}
                    type="button"
                    className="prompt-chip"
                    onClick={() => setQuestion(promptText.slice(0, 200))}
                    disabled={isLoading}
                  >
                    {promptText}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions Bar */}
            <div className="form-actions">
              <span className="shortcut-hint">Press Enter to submit, Shift+Enter for new line</span>
              <div className="buttons-group">
                {(question || response || error) && (
                  <button
                    type="button"
                    className="clear-btn"
                    onClick={handleClear}
                    disabled={isLoading}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="submit"
                  id="submit-ask-button"
                  className="submit-btn"
                  disabled={isLoading || !question.trim()}
                >
                  {isLoading ? (
                    <span>Sending...</span>
                  ) : (
                    <>
                      <span>Ask</span>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Loading State */}
          {isLoading && (
            <div className="loading-container">
              <div className="loading-ambient-glow" />

              {/* Glowing Concentric Orb Visual */}
              <div className="ai-orb-container">
                <div className="ai-orb-pulse-outer" />
                <div className="ai-orb-pulse-inner" />
                <div className="ai-orb-spinning-ring" />
                <div className="ai-orb-core">
                  <svg
                    className="ai-sparkle-icon"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
                  </svg>
                </div>
              </div>

              {/* Status & Dynamic Info */}
              <div className="loading-info">
                <div className="loading-badge">
                  <span className="loading-badge-pulse" />
                  <span>AI Agent Working</span>
                  <span className="loading-timer">&bull; {loadingSeconds}s</span>
                </div>
                <h4 className="loading-title">Retrieving from Knowledge Base...</h4>
                <p className="loading-subtitle">{getLoadingStageText(loadingSeconds)}</p>
              </div>

              {/* Shimmering Response Placeholder Skeleton */}
              <div className="loading-skeleton-wrap" aria-hidden="true">
                <div className="skeleton-line line-1" />
                <div className="skeleton-line line-2" />
                <div className="skeleton-line line-3" />
              </div>
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="error-container">
              <div className="error-icon">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="error-content">
                <h3 className="error-title">Request Error</h3>
                <p className="error-message">{error}</p>
                <button
                  type="button"
                  className="error-retry-btn"
                  onClick={() => handleSubmit()}
                >
                  Retry Request
                </button>
              </div>
            </div>
          )}

          {/* Dynamic Response Container */}
          {response && !isLoading && (
            console.log("response", response),         
            <section className="response-card" aria-label="API Response">
              
              <div className="response-header">
                <div className="response-title-group">
                  <span className="response-badge">API Response</span>
                  
                  {/* {metadata && (
                    <div className="meta-stats">
                      {typeof metadata.latencyMs === "number" && (
                        <span className="meta-stat">
                          {(metadata.latencyMs / 1000).toFixed(2)}s latency
                        </span>
                      )}
                      {typeof metadata.retrievedFactCount === "number" && (
                        <span className="meta-stat">
                          {metadata.retrievedFactCount} facts retrieved
                        </span>
                      )}
                    </div>
                  )} */}
                </div>

                <div className="response-actions">
                  <button
                    type="button"
                    className={`copy-btn ${copied ? "copied" : ""}`}
                    onClick={handleCopy}
                    aria-label="Copy response to clipboard"
                  >
                    {copied ? (
                      <>
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
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
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
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="response-body">
                {response}
              </div>
            </section>
          )}
        </div>

        <footer className="page-footer">
          Powered by Technyx Systems RAG &amp; Next.js
        </footer>
      </main>
    </div>
  );
}
