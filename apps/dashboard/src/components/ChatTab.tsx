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
        } else if (data.code === 'SESSION_MISSING' || data.code === 'SESSION_INVALID') {
          setErrorBanner('Your session has expired or is invalid. Please sign out and log in again.');
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
    'List all published products with prices',
    'What orders came in recently?',
    'Search customer contacts for "Sarah"',
    'Show pending high-priority tasks',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', gap: '1rem' }}>
      {/* WordPress Card Header */}
      <div
        className="wp-card"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          background: '#ffffff',
          border: '1px solid var(--wp-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '3px',
              background: 'var(--woo-purple)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: '18px',
            }}
          >
            🤖
          </div>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--wp-text-primary)', margin: 0 }}>
              WooCommerce &amp; Store AI Copilot
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', margin: 0 }}>
              Autonomous conversational agent executing tools across WooCommerce catalog, Customer CRM, and Task lists.
            </p>
          </div>
        </div>

        <button
          id="chat-clear-btn"
          onClick={clearChat}
          className="btn btn-secondary"
          style={{ padding: '0.25rem 0.65rem', fontSize: '12px', minHeight: '28px' }}
        >
          Clear Chat
        </button>
      </div>

      {/* Error Notice */}
      {errorBanner && (
        <div className="wp-notice wp-notice-error animate-fade-in" id="chat-error-banner" style={{ margin: 0 }}>
          <span>⚠️ {errorBanner}</span>
          <button
            onClick={() => setErrorBanner(null)}
            style={{ background: 'none', border: 'none', color: '#50575e', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Chat Messages Scrolling Container */}
      <div
        id="chat-messages-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.25rem',
          background: '#ffffff',
          border: '1px solid var(--wp-border)',
          borderRadius: '4px',
          boxShadow: 'var(--wp-shadow-card)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              maxWidth: '540px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
              padding: '2rem 1rem',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: '#f0f6fc',
                color: 'var(--wp-blue)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
              }}
            >
              💬
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--wp-text-primary)', marginBottom: '0.35rem' }}>
                How can I assist your WooCommerce store today?
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--wp-text-secondary)', lineHeight: 1.45 }}>
                Ask questions to query inventory, inspect customer orders, check stock levels, or manage team tasks.
              </p>
            </div>

            {/* Starter Suggestion Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center' }}>
              {samplePrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(prompt)}
                  className="btn btn-secondary"
                  style={{ fontSize: '12px', padding: '0.25rem 0.65rem', minHeight: '28px' }}
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
                  gap: '0.25rem',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--wp-text-muted)', padding: '0 0.35rem' }}>
                  {isUser ? 'You' : 'Store Assistant'} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>

                <div
                  style={{
                    maxWidth: '85%',
                    padding: '0.85rem 1.15rem',
                    borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    background: isUser ? 'var(--wp-blue)' : '#f6f7f7',
                    border: isUser ? '1px solid #135e96' : '1px solid #dcdcde',
                    color: isUser ? '#ffffff' : 'var(--wp-text-primary)',
                    fontSize: '13px',
                    lineHeight: '1.55',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  }}
                >
                  {msg.text}
                </div>

                {/* Render Tool Execution Pills */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.35rem', width: '100%', maxWidth: '85%' }}>
                    {msg.toolCalls.map((tc, idx) => {
                      const toolId = `${msg.id}-tool-${idx}`;
                      const isExpanded = !!expandedTools[toolId];
                      const isSuccess = tc.status === 'success';
                      const isConfRequired = tc.status === 'confirmation_required';

                      return (
                        <div
                          key={idx}
                          style={{
                            background: '#ffffff',
                            border: '1px solid var(--wp-border-subtle)',
                            borderRadius: '3px',
                            padding: '0.45rem 0.75rem',
                            fontSize: '12px',
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                              <span>{isSuccess ? '✅' : isConfRequired ? '⏳' : '❌'}</span>
                              <code style={{ color: '#135e96', fontWeight: 600 }}>{tc.name}</code>
                              <span
                                className={`badge badge-${isSuccess ? 'success' : isConfRequired ? 'warning' : 'danger'}`}
                                style={{ fontSize: '10px', padding: '0.1rem 0.4rem' }}
                              >
                                {tc.status}
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--wp-text-muted)' }}>
                              {tc.durationMs !== undefined && <span>{tc.durationMs}ms</span>}
                              <span>{isExpanded ? '▲' : '▼'}</span>
                            </div>
                          </div>

                          {/* Expanded Arguments & Result View */}
                          {isExpanded && (
                            <div style={{ marginTop: '0.45rem', borderTop: '1px solid #e2e4e7', paddingTop: '0.45rem' }}>
                              <div style={{ marginBottom: '0.35rem' }}>
                                <span style={{ color: 'var(--wp-text-muted)', fontSize: '11px', fontWeight: 600 }}>Arguments:</span>
                                <pre
                                  style={{
                                    background: '#f6f7f7',
                                    padding: '0.35rem 0.5rem',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                    overflowX: 'auto',
                                    border: '1px solid var(--wp-border-subtle)',
                                    color: '#2c3338',
                                  }}
                                >
                                  {JSON.stringify(tc.args, null, 2)}
                                </pre>
                              </div>

                              {tc.result !== undefined && (
                                <div>
                                  <span style={{ color: 'var(--wp-text-muted)', fontSize: '11px', fontWeight: 600 }}>Result:</span>
                                  <pre
                                    style={{
                                      background: '#f6f7f7',
                                      padding: '0.35rem 0.5rem',
                                      borderRadius: '3px',
                                      fontSize: '11px',
                                      overflowX: 'auto',
                                      maxHeight: '160px',
                                      overflowY: 'auto',
                                      border: '1px solid var(--wp-border-subtle)',
                                      color: '#2c3338',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', color: 'var(--wp-text-secondary)', padding: '0.5rem', fontSize: '13px' }}>
            <span style={{ fontSize: '16px' }}>⚙️</span>
            <span>Consulting WooCommerce MCP tools...</span>
          </div>
        )}

        {/* Pending Confirmation Notice */}
        {pendingConfirmation && (
          <div
            id="chat-confirmation-card"
            className="wp-notice wp-notice-warning"
            style={{
              margin: '0.5rem 0',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '0.75rem',
            }}
          >
            <div>
              <strong style={{ color: '#996800', fontSize: '13px' }}>
                ⚠️ Security Confirmation Required
              </strong>
              <p style={{ margin: '0.25rem 0 0', color: 'var(--wp-text-secondary)', fontSize: '12px' }}>
                The assistant is proposing an action that mutates store records. Confirmation is required.
              </p>
            </div>

            <div style={{ background: '#ffffff', padding: '0.5rem 0.75rem', borderRadius: '3px', border: '1px solid #fae8a7', fontSize: '12px' }}>
              <strong>Prompt:</strong> {pendingConfirmation.prompt}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCancelConfirmation}
                className="btn btn-secondary"
                disabled={isLoading}
                style={{ padding: '0.25rem 0.65rem', minHeight: '28px', fontSize: '12px' }}
              >
                Reject &amp; Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                className="btn btn-primary"
                disabled={isLoading}
                style={{ padding: '0.25rem 0.65rem', minHeight: '28px', fontSize: '12px' }}
              >
                {isLoading ? 'Executing...' : 'Approve & Execute Mutation'}
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input Box */}
      <div
        className="wp-card"
        style={{
          background: '#ffffff',
          border: '1px solid var(--wp-border)',
          padding: '0.75rem 1rem',
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'flex-end',
        }}
      >
        <textarea
          ref={textareaRef}
          id="chat-input-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question or issue a command (e.g. 'List our published products with stock levels')..."
          disabled={isLoading}
          rows={2}
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            fontSize: '13px',
            fontFamily: 'var(--wp-font-sans)',
            border: '1px solid #8c8f94',
            borderRadius: '4px',
            resize: 'none',
            outline: 'none',
          }}
        />

        <button
          id="chat-send-btn"
          onClick={() => handleSendMessage()}
          className="btn btn-primary"
          disabled={!input.trim() || isLoading}
          style={{ minHeight: '44px', padding: '0 1.25rem', fontSize: '13px' }}
        >
          {isLoading ? 'Processing...' : 'Send Message'}
        </button>
      </div>
    </div>
  );
};
