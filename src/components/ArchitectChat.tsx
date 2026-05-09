import React, { useState, useEffect, useRef } from 'react';
import { chatWithArchitect } from '../services/gemini';
import { ChatMessage } from '../types';
import { getAllNotes } from '../services/dbManager';

export const ArchitectChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [blueprintSummary, setBlueprintSummary] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchBlueprint = async () => {
      const notes = await getAllNotes();
      const summary = notes.map(n => `[${n.noteType}] ${n.title}: ${n.summary}`).join('\n');
      setBlueprintSummary(summary);
    };
    fetchBlueprint();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await chatWithArchitect(
        [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
        blueprintSummary
      );

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border rounded-lg shadow-sm">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-lg ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {isLoading && <div className="text-gray-500">아키텍트가 생각 중...</div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 border-t flex gap-2">
        <input
          className="flex-1 p-2 border rounded"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder="아키텍트에게 질문하세요..."
        />
        <button className="p-2 bg-blue-500 text-white rounded" onClick={handleSend} disabled={isLoading}>
          전송
        </button>
      </div>
    </div>
  );
};
