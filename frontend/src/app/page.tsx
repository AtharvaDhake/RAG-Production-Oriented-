"use client";

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

type Citation = {
  text: string;
  page: number;
  source: string;
};

type Message = {
  id: string;
  role: 'user' | 'bot';
  content: string;
  citations?: Citation[];
  isTyping?: boolean;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Audio synthesis for retro sounds
  const playSound = (type: 'send' | 'receive' | 'typing') => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === 'send') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === 'receive') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === 'typing') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        gain.gain.setValueAtTime(0.02, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
      }
    } catch (e) {
      console.error("Audio play failed", e);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [theme]);

  // Typing sound interval
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      interval = setInterval(() => {
        playSound('typing');
      }, 400); // Syncs roughly with bouncing dots
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    playSound('send');
    
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    // Add temporary typing message
    const typingId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: typingId, role: 'bot', content: '', isTyping: true }]);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
      const res = await fetch(`${apiUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMsg.content }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Server error: ${res.status}`);
      }
      
      const data = await res.json();
      
      playSound('receive');
      
      setMessages(prev => 
        prev.map(msg => 
          msg.id === typingId 
            ? { ...msg, isTyping: false, content: data.reply, citations: data.citations }
            : msg
        )
      );
    } catch (error: any) {
      console.error(error);
      playSound('receive');
      setMessages(prev => 
        prev.map(msg => 
          msg.id === typingId 
            ? { ...msg, isTyping: false, content: `Error: ${error.message || 'Connection failed'}` }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ width: '60px' }}></div>
        <h1 style={{ margin: 0 }}>RAG Chatbot: Built from Scratch</h1>
        <button 
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            padding: '4px 8px',
            fontFamily: 'JetBrains Mono',
            fontSize: '0.8rem',
            width: '60px'
          }}
        >
          {theme === 'dark' ? 'LIGHT' : 'DARK'}
        </button>
      </header>

      <main className="chat-container">
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: '50px', color: '#666', fontFamily: 'JetBrains Mono' }}>
            System ready. Awaiting input.
          </div>
        )}
        
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-bubble">
              {msg.isTyping ? (
                <div className="typing-dots">
                  <div className="dot"></div>
                  <div className="dot"></div>
                  <div className="dot"></div>
                </div>
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              )}
            </div>
            
            {msg.citations && msg.citations.length > 0 && (
              <div className="citations-container">
                {msg.citations.map((cit, idx) => (
                  <button 
                    key={idx} 
                    className="citation-chip"
                    onClick={() => setActiveCitation(cit)}
                  >
                    [Source {idx + 1}: p.{cit.page}]
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      <form className="input-container" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter query..."
          disabled={isLoading}
        />
        <button type="submit" className="send-button" disabled={isLoading || !input.trim()}>
          {isLoading ? '...' : 'SEND'}
        </button>
      </form>

      {/* Citation Modal */}
      {activeCitation && (
        <div className="modal-overlay" onClick={() => setActiveCitation(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setActiveCitation(null)}>×</button>
            <h3 style={{ marginBottom: '15px', fontFamily: 'JetBrains Mono', fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              Citation Source (Page {activeCitation.page})
            </h3>
            <p className="modal-text">
              {activeCitation.text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
