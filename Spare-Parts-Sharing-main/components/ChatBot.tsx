import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Bot, Sparkles, User, Loader2, Key, Globe, Search } from 'lucide-react';
import { askChatBot, ChatMessage, getGeminiApiKey } from '../services/geminiService';
import { SparePart } from '../types';
import Markdown from 'react-markdown';

interface ChatBotProps {
  allParts: SparePart[];
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: Date;
  webSearchQueries?: string[];
  groundingSources?: Array<{ title: string; uri: string }>;
}

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'can\'t', 'cannot', 'could', 'couldn\'t',
  'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
  'each', 'few', 'for', 'from', 'further',
  'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s',
  'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself',
  'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my', 'myself',
  'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such',
  'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very',
  'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t',
  'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
  // domain-specific generic terms
  'spare', 'spares', 'part', 'parts', 'item', 'items', 'inventory', 'stock', 'total', 'many', 'much', 'show', 'list', 'find', 'get', 'give', 'detail', 'details', 'value', 'price'
]);

export const ChatBot: React.FC<ChatBotProps> = ({ allParts, isOpen, setIsOpen }) => {
  const [hasApiKey, setHasApiKey] = useState(getGeminiApiKey() !== "Missing_Key");
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: "Hi! I am **SpareBot**. Ask me anything about our spare parts, stock levels, or which machines they are used for! (e.g., 'Which machine uses Ball Bearings?' or 'What parts are used in the Kiln?')",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Context retrieval helper
  const getRelevantSparesContext = (queryText: string): SparePart[] => {
    if (!queryText.trim()) return [];
    
    // Split and filter terms to keep only meaningful keywords
    let terms = queryText
      .toLowerCase()
      .trim()
      .split(/[^a-zA-Z0-9]+/)
      .filter(term => term.length > 1 && !STOP_WORDS.has(term));
    
    // Expand abbreviations to improve factory matching
    if (terms.includes('lt')) {
      terms.push('lanka', 'tiles');
    }
    if (terms.includes('lwt')) {
      terms.push('lanka', 'wall', 'tiles');
    }
    if (terms.includes('rh')) {
      terms.push('rocell', 'horana');
    }
    if (terms.includes('re')) {
      terms.push('rocell', 'eheliyagoda');
    }
    
    // If no specific terms are left (e.g., "what is the total value?"), do not search specific parts
    if (terms.length === 0) return [];
    
    const scored = allParts.map(part => {
      let score = 0;
      const searchString = `${part.description} ${part.partNumber || ''} ${part.machine || ''} ${part.categoryName || ''} ${part.factoryId} ${part.materialNumber}`.toLowerCase();
      
      terms.forEach(term => {
        if (searchString.includes(term)) {
          score += 1;
          if (part.description.toLowerCase().includes(term)) score += 2;
          if (part.machine && part.machine.toLowerCase().includes(term)) score += 3;
          if (part.partNumber && part.partNumber.toLowerCase().includes(term)) score += 3;
        }
      });
      return { part, score };
    });

    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map(item => item.part);
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    
    // Add user message
    const userMsgId = `user-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: userMsgId,
      sender: 'user',
      text: userText,
      timestamp: new Date()
    }]);

    setIsLoading(true);

    try {
      // 1. Get relevant context parts (keywords search)
      const contextSpares = getRelevantSparesContext(userText);
      console.log(`[ChatBot] Query: "${userText}" - Found ${contextSpares.length} matching context items.`);

      // 2. Compute Consolidated Statistics from ALL parts
      const totalSKUs = allParts.length;
      const totalQuantity = allParts.reduce((sum, p) => sum + (p.onHand || 0), 0);
      const totalValue = allParts.reduce((sum, p) => sum + (p.totalValue || 0), 0);
      
      // Factory Breakdown
      const factoryStats: Record<string, { skus: number; value: number; quantity: number }> = {};
      allParts.forEach(p => {
        const fid = p.factoryId || 'Unknown';
        if (!factoryStats[fid]) {
          factoryStats[fid] = { skus: 0, value: 0, quantity: 0 };
        }
        factoryStats[fid].skus += 1;
        factoryStats[fid].value += p.totalValue || 0;
        factoryStats[fid].quantity += p.onHand || 0;
      });

      // Dead Stock (3+ Years) stats
      let deadStockSKUs = 0;
      let deadStockQty = 0;
      let deadStockVal = 0;
      allParts.forEach(p => {
        const qty = p.qtyMoreThan3Years || 0;
        if (qty > 0) {
          deadStockSKUs += 1;
          deadStockQty += qty;
          deadStockVal += p.valueMoreThan3Years || 0;
        }
      });

      const factoryBreakdownText = Object.entries(factoryStats)
        .map(([name, stats]) => `- ${name}: ${stats.skus.toLocaleString()} SKUs, Total Qty: ${stats.quantity.toLocaleString()} units, value: Rs. ${stats.value.toLocaleString()}`)
        .join('\n');

      const systemSummaryText = `
        - Total Parts in System (SKU Count): ${totalSKUs.toLocaleString()}
        - Total Quantity in System: ${totalQuantity.toLocaleString()} units
        - Total Consolidated Value: Rs. ${totalValue.toLocaleString()}
        - Dead Stock (3+ Years): ${deadStockSKUs.toLocaleString()} SKUs, ${deadStockQty.toLocaleString()} units, total value: Rs. ${deadStockVal.toLocaleString()}
        - Factory breakdown:
        ${factoryBreakdownText}
      `.trim();

      // 3. Format history for API
      const apiHistory: ChatMessage[] = messages.map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        text: m.text
      }));

      // 4. Request answer from Gemini with context and consolidated summary
      const botResponse = await askChatBot(userText, apiHistory, contextSpares, systemSummaryText);

      // Add bot message
      setMessages(prev => [...prev, {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: botResponse.text,
        webSearchQueries: botResponse.webSearchQueries,
        groundingSources: botResponse.groundingSources,
        timestamp: new Date()
      }]);
    } catch (error) {
      console.error("[ChatBot] Failed to get response", error);
      setMessages(prev => [...prev, {
        id: `bot-error-${Date.now()}`,
        sender: 'bot',
        text: "I'm sorry, I'm having trouble retrieving details right now. Please try again in a few moments.",
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestion = (suggestion: string) => {
    setInput(suggestion);
  };

  const suggestions = [
    "spares for Press Machine",
    "where is temperature controller used?",
    "bearings at Lanka Tiles"
  ];

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Expanded Chat Window */}
      {isOpen && (
        <div className="w-96 h-[500px] bg-white/95 backdrop-blur-md rounded-[2rem] border border-gray-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden mb-4 animate-in fade-in slide-in-from-bottom-5 duration-300">
          {/* Header */}
          <div className="p-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-yellow-300">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black tracking-tight">SpareBot Assistant</h3>
                <span className="text-[10px] text-blue-100 font-bold uppercase tracking-wider flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                  Active Agent
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {hasApiKey && (
                <button
                  onClick={() => {
                    if (confirm("Clear saved Gemini API Key?")) {
                      localStorage.removeItem('GEMINI_API_KEY');
                      setHasApiKey(false);
                    }
                  }}
                  className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-blue-100 hover:text-white"
                  title="Reset API Key"
                >
                  <Key className="w-3.5 h-3.5" />
                </button>
              )}
              <button 
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
            {/* Key setup warning card */}
            {!hasApiKey && (
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-3 shadow-sm animate-in fade-in zoom-in duration-200">
                <div className="flex gap-2.5">
                  <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-black text-amber-900">Gemini API Key Required</h4>
                    <p className="text-[10px] text-amber-700 mt-1 leading-normal font-medium">
                      To enable the intelligent SpareBot assistant, please enter a valid Google Gemini API Key. It will be saved securely inside your browser's local storage.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="Enter API Key (AIzaSy...)"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-white border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none font-medium"
                    onKeyDown={(e) => e.key === 'Enter' && apiKeyInput.trim() && (
                      localStorage.setItem('GEMINI_API_KEY', apiKeyInput.trim()),
                      setHasApiKey(true),
                      setApiKeyInput('')
                    )}
                  />
                  <button
                    onClick={() => {
                      if (apiKeyInput.trim()) {
                        localStorage.setItem('GEMINI_API_KEY', apiKeyInput.trim());
                        setHasApiKey(true);
                        setApiKeyInput('');
                      }
                    }}
                    className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition-colors shadow-sm"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
            {messages.map((m) => {
              const isBot = m.sender === 'bot';
              return (
                <div 
                  key={m.id} 
                  className={`flex items-start gap-2.5 ${isBot ? 'justify-start' : 'justify-end'}`}
                >
                  {isBot && (
                    <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                      <Sparkles className="w-4 h-4 text-blue-500" />
                    </div>
                  )}
                  <div className={`
                    max-w-[75%] rounded-2xl p-3.5 text-xs shadow-sm leading-relaxed
                    ${isBot 
                      ? 'bg-white text-gray-800 border border-gray-100 rounded-tl-sm' 
                      : 'bg-blue-600 text-white rounded-tr-sm font-medium'}
                  `}>
                    {isBot && m.webSearchQueries && m.webSearchQueries.length > 0 && (
                      <div className="flex flex-col gap-1 mb-2 text-[10px] text-gray-500 bg-gray-50/50 border border-gray-100/80 rounded-xl p-2 animate-in fade-in slide-in-from-top-1 duration-200">
                        <div className="flex items-center gap-1.5 font-bold text-gray-700">
                          <Search className="w-3 h-3 text-blue-500 shrink-0" />
                          <span>Searched Google for:</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {m.webSearchQueries.map((q, idx) => (
                            <span key={idx} className="bg-blue-50 text-blue-700 border border-blue-100 rounded-lg px-2 py-0.5 font-bold text-[9px]">
                              "{q}"
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {isBot ? (
                      <div className="prose prose-xs max-w-none">
                        <Markdown>{m.text}</Markdown>
                      </div>
                    ) : (
                      <p>{m.text}</p>
                    )}

                    {isBot && m.groundingSources && m.groundingSources.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-gray-100/80 animate-in fade-in duration-300">
                        <div className="flex items-center gap-1 text-[9px] font-black text-gray-400 uppercase tracking-wider mb-2">
                          <Globe className="w-2.5 h-2.5 text-gray-400" />
                          <span>Sources & Citations</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {m.groundingSources.map((source, idx) => (
                            <a
                              key={idx}
                              href={source.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 border border-gray-200/60 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 rounded-xl text-[9px] font-bold text-gray-600 transition-all max-w-[220px]"
                              title={source.title}
                            >
                              <Globe className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                              <span className="truncate">{source.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {!isBot && (
                    <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                      <User className="w-4 h-4 text-blue-600" />
                    </div>
                  )}
                </div>
              );
            })}
            
            {isLoading && (
              <div className="flex items-center gap-2.5 justify-start">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                  <Sparkles className="w-4 h-4 text-blue-500" />
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm p-3.5 flex items-center gap-2 shadow-sm">
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Analyzing spares...</span>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {messages.length === 1 && (
            <div className="px-4 py-2 bg-white flex flex-wrap gap-2">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestion(s)}
                  className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 rounded-full px-3 py-1.5 transition-all outline-none"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input Panel */}
          <div className="p-3 bg-white border-t border-gray-100">
            <div className="relative flex items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about parts & machine mappings..."
                className="w-full pl-4 pr-12 py-3 bg-gray-50 border border-gray-200/60 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 outline-none text-xs transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="absolute right-2 p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:bg-blue-600 disabled:hover:translate-y-0 transition-all shadow-sm"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pulsing Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="h-14 w-14 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-xl shadow-blue-200 border-2 border-white hover:scale-105 active:scale-95 transition-all relative group"
        title="Open SpareBot Assistant"
      >
        <MessageSquare className="w-6 h-6 group-hover:rotate-12 transition-transform" />
        {/* Glow pulsing rings */}
        <span className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping -z-10 opacity-75"></span>
      </button>
    </div>
  );
};
