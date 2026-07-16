import React, { useState } from 'react';
import { analyzeInventory } from '../services/geminiService';
import { SparePart } from '../types';
import { Sparkles, Loader2, MessageSquare, X } from 'lucide-react';
import Markdown from 'react-markdown';

interface AIInsightsProps {
  data: SparePart[];
  isOpen: boolean;
  onClose: () => void;
}

export const AIInsights: React.FC<AIInsightsProps> = ({ data, isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!query.trim()) return;
    
    setIsLoading(true);
    setResponse('');
    
    try {
      const result = await analyzeInventory(query, data);
      setResponse(result);
    } finally {
      setIsLoading(false);
    }
  };

  const suggestions = [
    "Identify top 5 candidates for inter-factory transfer.",
    "Which machine category has the highest value of dead stock?",
    "Summarize the inventory health of Factory 1 vs Factory 2.",
    "Are there duplicate high-cost motors across factories?"
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-yellow-300" />
            <div>
                <h2 className="text-lg font-bold">Smart Inventory Assistant</h2>
                <p className="text-xs text-blue-100 opacity-90">Powered by Gemini 2.0</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {!response && (
                <div className="space-y-4">
                    <p className="text-sm text-gray-500">Ask a question about your inventory to discover optimization opportunities.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {suggestions.map((s, i) => (
                            <button 
                                key={i}
                                onClick={() => setQuery(s)}
                                className="text-left text-sm p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-gray-700"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {isLoading && (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                    <p className="text-sm text-gray-500 animate-pulse">Analyzing {data.length} records...</p>
                </div>
            )}

            {response && (
                <div className="prose prose-sm prose-blue max-w-none bg-gray-50 p-6 rounded-xl border border-gray-100">
                    <Markdown>{response}</Markdown>
                </div>
            )}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-gray-100 bg-white">
            <div className="relative flex items-center">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask about your spares..."
                    className="w-full pl-4 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                />
                <button 
                    onClick={handleAnalyze}
                    disabled={isLoading || !query.trim()}
                    className="absolute right-2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
                >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};