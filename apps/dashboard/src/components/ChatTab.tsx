import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export interface ChatToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'success' | 'error' | 'confirmation_required';
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ChatToolCall[];
  timestamp: number;
  confirmationToken?: string;
  confirmationPrompt?: string;
}

export const ChatTab: React.FC = () => {
  const { csrfToken } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    token: string;
    prompt: string;
    toolCall?: ChatToolCall;
  } | null>(null);

  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, pendingConfirmation]);

  const toggleExpand = (toolId: string) => {
    setExpandedTools((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  const handleSendMessage = async (userPrompt?: string) => {
    const textToSend = (userPrompt ?? input).trim();
    if (!textToSend || isLoading) return;

    setErrorBanner(null);
    setInput('');

    const userMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      text: textToSend,
      timestamp: Date.now(),
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setIsLoading(true);

    try {
      // Build lightweight conversation history for backend context
      const historyPayload = newHistory.slice(-10).map((m) => ({
        role: m.role,
        content: m.text,
      }));

      const res = await fetch('/api/v1/browser/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          message: textToSend,
          history: historyPayload,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'PROVIDER_UNCONFIGURED') {
          setErrorBanner('The chat assistant is not configured with a valid model provider credential (GEMINI_API_KEY). Please set the credential on the server to enable AI features.');
        } else if (data.code === 'PROVIDER_RATE_LIMITED') {
          setErrorBanner('The model provider rate limit was exceeded. Please wait a moment and try again.');
        } else if (data.code === 'PROVIDER_TIMEOUT') {
          setErrorBanner('The chat request timed out after 30 seconds. Please try a simpler request.');
        } else {
          setErrorBanner(data.error || 'Failed to communicate with the assistant.');
        }

        const assistantErrMsg: ChatMessage = {
          id: `msg-${Date.now()}-err`,
          role: 'assistant',
          text: data.error ? `Error: ${data.error}` : 'Sorry, I encountered an error processing your request.',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantErrMsg]);
        return;
      }

      // Check if turn requires user confirmation
      if (data.confirmationToken) {
        const requiredTool = data.toolCalls?.find((t: ChatToolCall) => t.status === 'confirmation_required');
        setPendingConfirmation({
          token: data.confirmationToken,
          prompt: data.confirmationPrompt || data.message,
          toolCall: requiredTool,
        });
      } else {
        setPendingConfirmation(null);
      }

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-asst`,
        role: 'assistant',
        text: data.message,
        toolCalls: data.toolCalls,
        timestamp: Date.now(),
        confirmationToken: data.confirmationToken,
        confirmationPrompt: data.confirmationPrompt,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : 'Network error during chat request.';
      setErrorBanner(errStr);
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-err`,
          role: 'assistant',
          text: `Error connecting to gateway: ${errStr}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleConfirmAction = async () => {
    if (!pendingConfirmation || isLoading) return;

    setErrorBanner(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/v1/browser/chat/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          confirmationToken: pendingConfirmation.token,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorBanner(data.error || 'Failed to execute confirmed action.');
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}-err`,
            role: 'assistant',
            text: `Action rejected: ${data.error || 'Confirmation failed'}`,
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      setPendingConfirmation(null);

      const confirmedMessage: ChatMessage = {
        id: `msg-${Date.now()}-confirmed`,
        role: 'assistant',
        text: data.message,
        toolCalls: data.toolCalls,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, confirmedMessage]);
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : 'Network error executing confirmed action.';
      setErrorBanner(errStr);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelConfirmation = () => {
    setPendingConfirmation(null);
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-cancelled`,
        role: 'assistant',
        text: 'Action cancelled by user. No mutations were applied.',
        timestamp: Date.now(),
      },
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setPendingConfirmation(null);
    setErrorBanner(null);
  };

  const samplePrompts = [
    'What orders came in today?',
    'List all published products with prices',
    'Search CRM contacts for "Sarah"',
    'Show pending high-priority tasks',
    'Create a demo product named "Summer Cap" with price 29.99',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)', gap: '1rem' }}>
      {/* Top Header Card */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1.25rem 1.75rem',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-surface-glass)',
          border: '1px solid var(--border-subtle)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, var(--brand-primary), var(--accent-cyan))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 16px var(--brand-glow)',
              fontSize: '1.4rem',
            }}
          >
            🤖
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Urumi Platform Assistant</h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0 }}>
              Autonomous conversational agent executing tools across WooCommerce, CRM, and Tasks through the Gateway.
            </p>
          </div>
        </div>

        <button
          id="chat-clear-btn"
          onClick={clearChat}
          className="btn btn-secondary"
          style={{ padding: '0.45rem 0.95rem', fontSize: '0.8125rem' }}
          title="Clear ephemeral chat history"
        >
          🗑️ Clear Conversation
        </button>
      </div>

      {/* Error Banner */}
      {errorBanner && (
        <div
          id="chat-error-banner"
          style={{
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--status-danger-bg)',
            border: '1px solid var(--status-danger)',
            color: '#fca5a5',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span>⚠️</span>
            <span>{errorBanner}</span>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '1.1rem' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Chat Messages Scrolling Container */}
      <div
        id="chat-messages-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.5rem',
          borderRadius: 'var(--radius-lg)',
          background: 'rgba(10, 15, 26, 0.4)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              maxWidth: '600px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.5rem',
              padding: '2rem 1rem',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.12)',
                border: '1px solid var(--border-highlight)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2rem',
              }}
            >
              💬
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem' }}>How can I help you today?</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Ask questions to query WooCommerce orders, inspect catalog inventory, look up CRM contacts, or create tasks.
              </p>
            </div>

            {/* Starter Suggestion Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
              {samplePrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(prompt)}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-full)',
                    padding: '0.5rem 1rem',
                    color: 'var(--text-secondary)',
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--brand-primary)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  gap: '0.35rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0 0.5rem' }}>
                  {isUser ? 'You' : 'Urumi Assistant'} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>

                <div
                  style={{
                    maxWidth: '85%',
                    padding: '1rem 1.25rem',
                    borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: isUser
                      ? 'linear-gradient(135deg, var(--brand-primary), #4f46e5)'
                      : 'var(--bg-surface-elevated)',
                    border: isUser ? 'none' : '1px solid var(--border-subtle)',
                    color: '#fff',
                    fontSize: '0.9375rem',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    boxShadow: isUser ? '0 4px 12px var(--brand-glow)' : '0 4px 12px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  {msg.text}
                </div>

                {/* Render Tool Execution Pills */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem', width: '100%', maxWidth: '85%' }}>
                    {msg.toolCalls.map((tc, idx) => {
                      const toolId = `${msg.id}-tool-${idx}`;
                      const isExpanded = !!expandedTools[toolId];
                      const isSuccess = tc.status === 'success';
                      const isConfRequired = tc.status === 'confirmation_required';

                      return (
                        <div
                          key={idx}
                          style={{
                            background: 'rgba(0, 0, 0, 0.35)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-md)',
                            padding: '0.5rem 0.85rem',
                            fontSize: '0.8125rem',
                          }}
                        >
                          <div
                            onClick={() => toggleExpand(toolId)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.9rem' }}>
                                {isSuccess ? '✅' : isConfRequired ? '⏳' : '❌'}
                              </span>
                              <code style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{tc.name}</code>
                              <span
                                style={{
                                  fontSize: '0.6875rem',
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: 'var(--radius-full)',
                                  background: isSuccess
                                    ? 'var(--status-success-bg)'
                                    : isConfRequired
                                    ? 'var(--status-warning-bg)'
                                    : 'var(--status-danger-bg)',
                                  color: isSuccess
                                    ? 'var(--status-success)'
                                    : isConfRequired
                                    ? 'var(--status-warning)'
                                    : 'var(--status-danger)',
                                  fontWeight: 600,
                                }}
                              >
                                {tc.status}
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
                              {tc.durationMs !== undefined && <span>{tc.durationMs}ms</span>}
                              <span>{isExpanded ? '▲' : '▼'}</span>
                            </div>
                          </div>

                          {/* Expanded Arguments & Result View */}
                          {isExpanded && (
                            <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
                              <div style={{ marginBottom: '0.4rem' }}>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600 }}>Arguments:</span>
                                <pre
                                  style={{
                                    background: 'rgba(0, 0, 0, 0.5)',
                                    padding: '0.4rem',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.75rem',
                                    overflowX: 'auto',
                                  }}
                                >
                                  {JSON.stringify(tc.args, null, 2)}
                                </pre>
                              </div>

                              {tc.result !== undefined && (
                                <div>
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600 }}>Result:</span>
                                  <pre
                                    style={{
                                      background: 'rgba(0, 0, 0, 0.5)',
                                      padding: '0.4rem',
                                      borderRadius: 'var(--radius-sm)',
                                      fontSize: '0.75rem',
                                      overflowX: 'auto',
                                      maxHeight: '180px',
                                      overflowY: 'auto',
                                    }}
                                  >
                                    {typeof tc.result === 'object'
                                      ? JSON.stringify(tc.result, null, 2)
                                      : String(tc.result)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Loading Indicator */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-secondary)', padding: '0.5rem' }}>
            <div
              style={{
                width: '16px',
                height: '16px',
                border: '2px solid var(--brand-primary)',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <span style={{ fontSize: '0.875rem' }}>Assistant is consulting gateway tools...</span>
          </div>
        )}

        {/* Pending Confirmation Modal / Card */}
        {pendingConfirmation && (
          <div
            id="chat-confirmation-card"
            style={{
              padding: '1.25rem 1.5rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid var(--status-warning)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem',
              boxShadow: '0 8px 24px rgba(245, 158, 11, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '1.25rem' }}>⚠️</span>
              <div>
                <h4 style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--status-warning)' }}>
                  State Mutation Requires Your Confirmation
                </h4>
                <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  The model proposed an action that modifies persistent state. Security policy mandates explicit user authorization.
                </p>
              </div>
            </div>

            <div
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ marginBottom: '0.35rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Action: </span>
                <code style={{ color: 'var(--accent-cyan)' }}>{pendingConfirmation.toolCall?.name || 'Proposed Action'}</code>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Parameters: </span>
                <pre style={{ margin: '0.25rem 0 0', fontSize: '0.75rem' }}>
                  {JSON.stringify(pendingConfirmation.toolCall?.args ?? {}, null, 2)}
                </pre>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                id="chat-cancel-confirm-btn"
                onClick={handleCancelConfirmation}
                disabled={isLoading}
                className="btn btn-secondary"
                style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
              >
                Cancel
              </button>
              <button
                id="chat-execute-confirm-btn"
                onClick={handleConfirmAction}
                disabled={isLoading}
                className="btn btn-primary"
                style={{
                  padding: '0.5rem 1.25rem',
                  fontSize: '0.8125rem',
                  background: 'var(--status-success)',
                  borderColor: 'var(--status-success)',
                }}
              >
                {isLoading ? 'Executing...' : '✓ Confirm & Execute Action'}
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form Bar */}
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          padding: '0.75rem',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-surface-glass)',
          border: '1px solid var(--border-subtle)',
          alignItems: 'flex-end',
        }}
      >
        <textarea
          ref={textareaRef}
          id="chat-prompt-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question or request an action... (Press Enter to send, Shift+Enter for newline)"
          disabled={isLoading}
          rows={2}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: '0.9375rem',
            fontFamily: 'inherit',
            resize: 'none',
            outline: 'none',
            padding: '0.5rem',
          }}
        />

        <button
          id="chat-send-btn"
          onClick={() => handleSendMessage()}
          disabled={isLoading || !input.trim()}
          className="btn btn-primary"
          style={{
            padding: '0.75rem 1.5rem',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          {isLoading ? (
            <span>Sending...</span>
          ) : (
            <>
              <span>Send</span>
              <span>➔</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
