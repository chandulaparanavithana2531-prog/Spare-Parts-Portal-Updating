import React, { useState, useEffect } from 'react';
import { Search, Clock, User, Tag, Info, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { clearAuditLogs } from '../services/db';
import { getAuditLogs } from '../services/audit';
import { AuditLog } from '../types';

export const AuditLogs: React.FC = () => {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchLogs = async () => {
        setLoading(true);
        const data = await getAuditLogs(200);
        setLogs(data);
        setLoading(false);
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const filteredLogs = logs.filter(log => {
        const searchString = `${log.userId} ${log.action} ${log.entityType} ${log.details}`.toLowerCase();
        return searchString.includes(searchTerm.toLowerCase());
    });

    const getActionColor = (action: string) => {
        switch (action) {
            case 'CREATE': return 'bg-green-100 text-green-700';
            case 'UPDATE': return 'bg-blue-100 text-blue-700';
            case 'DELETE': return 'bg-red-100 text-red-700';
            case 'UPLOAD': return 'bg-purple-100 text-purple-700';
            case 'CLEAR_DATABASE': return 'bg-orange-100 text-orange-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    return (
        <div className="flex flex-col h-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header Control Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white/80 backdrop-blur-md p-6 rounded-[2rem] border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <div className="flex items-center gap-4 flex-1 max-w-md">
                    <div className="relative w-full group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                        <input
                            type="text"
                            placeholder="Search security logs..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-gray-50/50 border border-gray-200/60 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 focus:bg-white outline-none text-sm transition-all shadow-inner font-medium"
                        />
                    </div>
                </div>
                
                <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-400 mr-2">{filteredLogs.length} Events Logged</span>
                    
                    <button
                        onClick={async () => {
                            if (confirm("DANGER: This will delete ALL security audit logs permanently. Are you sure?")) {
                                setLoading(true);
                                try {
                                    // We'll use 'admin' as the performer since this tab is admin-only
                                    await clearAuditLogs('admin');
                                    await fetchLogs();
                                    alert("Audit logs cleared successfully.");
                                } catch (e) {
                                    console.error(e);
                                    alert("Failed to clear logs.");
                                } finally {
                                    setLoading(false);
                                }
                            }
                        }}
                        disabled={loading}
                        className="p-3 text-red-500 bg-red-50/50 border border-red-100 rounded-2xl hover:bg-red-50 hover:text-red-600 transition-all disabled:opacity-50"
                        title="Clear All Logs"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>

                    <button
                        onClick={fetchLogs}
                        disabled={loading}
                        className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 text-gray-700 text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-gray-50 hover:border-gray-300 hover:shadow-md transition-all duration-300 disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh Logs
                    </button>
                </div>
            </div>

            {/* Logs Table Container */}
            <div className="flex-1 bg-white/80 backdrop-blur-md border border-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-gray-100 bg-gray-50/30">
                                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Timestamp</th>
                                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Operator</th>
                                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Action</th>
                                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Target Entity</th>
                                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Payload Details</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center gap-4 text-gray-400">
                                            <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                                            <p className="text-xs font-black uppercase tracking-widest">Decrypting Logs...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center gap-2 text-gray-400">
                                            <ShieldAlert className="w-8 h-8 opacity-20" />
                                            <p className="text-xs font-bold">No matching security events found.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.map((log) => (
                                    <tr key={log.id} className="group hover:bg-blue-50/30 transition-colors">
                                        <td className="px-8 py-5 whitespace-nowrap">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-white group-hover:text-blue-600 transition-colors">
                                                    <Clock className="w-4 h-4" />
                                                </div>
                                                <div>
                                                    <p className="text-[13px] font-bold text-gray-700">
                                                        {new Date(log.timestamp).toLocaleDateString()}
                                                    </p>
                                                    <p className="text-[10px] font-medium text-gray-400">
                                                        {new Date(log.timestamp).toLocaleTimeString()}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-5 whitespace-nowrap">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-gray-100 to-gray-200 flex items-center justify-center border border-white shadow-sm">
                                                    <User className="w-4 h-4 text-gray-600" />
                                                </div>
                                                <span className="text-[13px] font-black text-gray-800 uppercase tracking-tight">{log.userId}</span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-5 whitespace-nowrap">
                                            <span className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-tiny ${getActionColor(log.action)}`}>
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="px-8 py-5 whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span className="text-[11px] font-black text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                                    <Tag className="w-3 h-3" />
                                                    {log.entityType}
                                                </span>
                                                <span className="text-[10px] font-mono text-gray-400 mt-1">ID: ...{log.entityId.slice(-8)}</span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-5">
                                            <div className="flex items-start gap-3 max-w-lg">
                                                <Info className="w-4 h-4 text-blue-400/50 mt-0.5 shrink-0" />
                                                <p className="text-[13px] text-gray-600 leading-relaxed font-medium line-clamp-2 italic">
                                                    "{log.details}"
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
