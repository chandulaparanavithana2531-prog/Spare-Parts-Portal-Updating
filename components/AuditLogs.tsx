import React, { useState, useEffect } from 'react';
import { Search, Clock, User as UserIcon, Tag, Info, RefreshCw, ShieldAlert, Trash2, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { clearAuditLogs, restoreSparePart, permanentDeleteSparePart } from '../services/db';
import { getAuditLogs } from '../services/audit';
import { User } from '../types';

interface AuditLogsProps {
    currentUser: User;
}

export const AuditLogs: React.FC<AuditLogsProps> = ({ currentUser }) => {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPlant, setSelectedPlant] = useState('All');
    const [selectedAction, setSelectedAction] = useState('All');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

    const fetchLogs = async () => {
        setLoading(true);
        const data = await getAuditLogs(300);
        setLogs(data);
        setLoading(false);
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const handleRestore = async (log: any) => {
        if (confirm(`Are you sure you want to restore the item: ${log.details || log.entityId}?`)) {
            setLoading(true);
            try {
                await restoreSparePart(log.entityId, currentUser.username);
                alert("Item restored successfully!");
                await fetchLogs();
            } catch (err: any) {
                alert(`Failed to restore item: ${err.message}`);
            } finally {
                setLoading(false);
            }
        }
    };

    const handlePermanentDelete = async (log: any) => {
        if (confirm(`WARNING: This action cannot be undone. Are you sure you want to PERMANENTLY delete the item with ID: ${log.entityId}?`)) {
            setLoading(true);
            try {
                await permanentDeleteSparePart(log.entityId, currentUser.username);
                alert("Item permanently deleted!");
                await fetchLogs();
            } catch (err: any) {
                alert(`Failed to permanently delete item: ${err.message}`);
            } finally {
                setLoading(false);
            }
        }
    };

    const filteredLogs = logs.filter(log => {
        // 1. Search term
        const searchString = `${log.userId || ''} ${log.action || ''} ${log.entityType || ''} ${log.details || ''} ${log.user_name || ''} ${log.entityId || ''}`.toLowerCase();
        if (searchTerm && !searchString.includes(searchTerm.toLowerCase())) {
            return false;
        }

        // 2. Plant Location
        const logPlant = log.plant_name || log.plant_id || 'System';
        if (selectedPlant !== 'All' && logPlant !== selectedPlant) {
            return false;
        }

        // 3. Action Type
        if (selectedAction !== 'All') {
            const actionLower = (log.action || '').toLowerCase();
            if (selectedAction === 'Created') {
                if (actionLower !== 'created' && actionLower !== 'create') return false;
            } else if (selectedAction === 'Edited') {
                if (actionLower !== 'updated' && actionLower !== 'update' && actionLower !== 'upload') return false;
            } else if (selectedAction === 'Deleted') {
                if (actionLower !== 'deleted' && actionLower !== 'delete') return false;
            } else if (selectedAction === 'Restored') {
                if (actionLower !== 'restored') return false;
            }
        }

        // 4. Date Range
        const logTime = log.timestamp || log.created_at;
        if (startDate) {
            const startMs = new Date(startDate).setHours(0, 0, 0, 0);
            if (logTime < startMs) return false;
        }
        if (endDate) {
            const endMs = new Date(endDate).setHours(23, 59, 59, 999);
            if (logTime > endMs) return false;
        }

        return true;
    });

    const getActionColor = (action: string) => {
        const actionUpper = (action || '').toUpperCase();
        switch (actionUpper) {
            case 'CREATED':
            case 'CREATE':
                return 'bg-green-100 text-green-700 border border-green-200';
            case 'UPDATED':
            case 'UPDATE':
            case 'UPLOAD':
                return 'bg-blue-100 text-blue-700 border border-blue-200';
            case 'DELETED':
            case 'DELETE':
                return 'bg-red-100 text-red-700 border border-red-200';
            case 'RESTORED':
                return 'bg-teal-100 text-teal-700 border border-teal-200';
            case 'CLEAR_DATABASE':
                return 'bg-orange-100 text-orange-700 border border-orange-200';
            default:
                return 'bg-gray-100 text-gray-700 border border-gray-200';
        }
    };

    const getPlantBadgeColor = (plant: string) => {
        switch (plant) {
            case 'Lanka Tiles':
                return 'bg-blue-50 text-blue-700 border border-blue-200';
            case 'Lanka Wall Tiles':
                return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
            case 'Rocell Horana':
                return 'bg-amber-50 text-amber-700 border border-amber-200';
            case 'Rocell Eheliyagoda':
                return 'bg-purple-50 text-purple-700 border border-purple-200';
            default:
                return 'bg-gray-50 text-gray-500 border border-gray-200';
        }
    };

    const parseChanges = (changesStr: string | null) => {
        if (!changesStr) return null;
        try {
            return typeof changesStr === 'string' ? JSON.parse(changesStr) : changesStr;
        } catch (e) {
            console.error("Failed to parse changes JSON:", e);
            return null;
        }
    };

    return (
        <div className="flex flex-col h-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header & Filter Controls Bar */}
            <div className="flex flex-col gap-6 bg-white/80 backdrop-blur-md p-6 rounded-[2rem] border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 max-w-md">
                        <div className="relative w-full group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                            <input
                                type="text"
                                placeholder="Search activity logs..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-12 pr-4 py-3 bg-gray-50/50 border border-gray-200/60 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 focus:bg-white outline-none text-sm transition-all shadow-inner font-medium"
                            />
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs font-bold text-gray-400 mr-2">{filteredLogs.length} Events Filtered</span>
                        
                        <button
                            onClick={async () => {
                                if (confirm("DANGER: This will delete ALL security audit logs permanently. Are you sure?")) {
                                    setLoading(true);
                                    try {
                                        await clearAuditLogs(currentUser.username);
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
                            className="p-3 text-red-500 bg-red-50/50 border border-red-100 rounded-2xl hover:bg-red-55 hover:text-red-650 transition-all disabled:opacity-50"
                            title="Clear All Logs"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>

                        <button
                            onClick={fetchLogs}
                            disabled={loading}
                            className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 text-gray-700 text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-gray-55 hover:border-gray-300 hover:shadow-md transition-all duration-300 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
                    <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Plant Location</label>
                        <select
                            value={selectedPlant}
                            onChange={(e) => setSelectedPlant(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-700 outline-none focus:bg-white focus:border-blue-500 transition-all"
                        >
                            <option value="All">All Plants</option>
                            <option value="Lanka Tiles">Lanka Tiles</option>
                            <option value="Lanka Wall Tiles">Lanka Wall Tiles</option>
                            <option value="Rocell Horana">Rocell Horana</option>
                            <option value="Rocell Eheliyagoda">Rocell Eheliyagoda</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Action Type</label>
                        <select
                            value={selectedAction}
                            onChange={(e) => setSelectedAction(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-700 outline-none focus:bg-white focus:border-blue-500 transition-all"
                        >
                            <option value="All">All Actions</option>
                            <option value="Created">Created</option>
                            <option value="Edited">Edited / Updated</option>
                            <option value="Deleted">Deleted</option>
                            <option value="Restored">Restored</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Start Date</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-700 outline-none focus:bg-white focus:border-blue-500 transition-all"
                        />
                    </div>

                    <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">End Date</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-700 outline-none focus:bg-white focus:border-blue-500 transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Logs Table Container */}
            <div className="flex-1 bg-white/80 backdrop-blur-md border border-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-gray-100 bg-gray-50/30">
                                <th className="w-8"></th>
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Timestamp</th>
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">User / Admin</th>
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Plant Location</th>
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Action Type</th>
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Entity Affected</th>
                                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center gap-4 text-gray-400">
                                            <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                                            <p className="text-xs font-black uppercase tracking-widest">Loading Logs...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center gap-2 text-gray-400">
                                            <ShieldAlert className="w-8 h-8 opacity-20" />
                                            <p className="text-xs font-bold">No matching activity logs found.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.map((log) => {
                                    const parsedChanges = parseChanges(log.changes);
                                    const hasChanges = parsedChanges && Object.keys(parsedChanges).length > 0;
                                    const isExpanded = expandedLogId === log.id;
                                    const isDeleted = (log.action || '').toUpperCase() === 'DELETED' || (log.action || '').toUpperCase() === 'DELETE';
                                    
                                    // Derive User Info
                                    const name = log.user_name || log.userId;
                                    const role = log.userId === 'admin' ? 'Admin' : 'User';
                                    const email = log.userId.includes('@') ? log.userId : (log.userId === 'admin' ? 'admin@spareshare.com' : 'N/A');

                                    return (
                                        <React.Fragment key={log.id}>
                                            <tr className="group hover:bg-blue-50/20 transition-colors">
                                                {/* Expand Caret */}
                                                <td className="pl-6 py-4">
                                                    {hasChanges && (
                                                        <button
                                                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                                            className="p-1 hover:bg-gray-150 rounded transition-colors text-gray-500"
                                                            title={isExpanded ? "Collapse Changes" : "Expand Changes"}
                                                        >
                                                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                        </button>
                                                    )}
                                                </td>

                                                {/* Timestamp */}
                                                <td className="px-6 py-4 whitespace-nowrap">
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

                                                {/* User / Admin */}
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="flex flex-col">
                                                        <span className="text-[13px] font-bold text-gray-800">{name}</span>
                                                        <span className="text-[10px] font-medium text-gray-400">
                                                            {role} &middot; {email}
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* Plant Location */}
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${getPlantBadgeColor(log.plant_name || log.plant_id)}`}>
                                                        {log.plant_name || log.plant_id || 'System'}
                                                    </span>
                                                </td>

                                                {/* Action Type */}
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-3 py-1 rounded-xl text-[9px] font-bold uppercase tracking-wider ${getActionColor(log.action)}`}>
                                                        {log.action}
                                                    </span>
                                                </td>

                                                {/* Entity Affected */}
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col">
                                                        <span className="text-[12px] font-bold text-gray-700 flex items-center gap-1">
                                                            <Tag className="w-3 h-3 text-gray-400" />
                                                            {log.entityType || 'inventory'}
                                                        </span>
                                                        <span className="text-[10px] font-mono text-gray-400 mt-0.5">ID: {log.entityId}</span>
                                                    </div>
                                                </td>

                                                {/* Actions */}
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    {isDeleted ? (
                                                        <div className="flex items-center justify-center gap-2">
                                                            <button
                                                                onClick={() => handleRestore(log)}
                                                                className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all duration-200 border border-teal-200 cursor-pointer"
                                                                title="Restore Deleted Item"
                                                            >
                                                                <RotateCcw className="w-3.5 h-3.5" />
                                                                Restore
                                                            </button>
                                                            <button
                                                                onClick={() => handlePermanentDelete(log)}
                                                                className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all duration-200 border border-red-200 cursor-pointer"
                                                                title="Permanently Delete Item"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                                Hard Delete
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[11px] text-gray-400 font-medium italic">Active Log</span>
                                                    )}
                                                </td>
                                            </tr>

                                            {/* Expandable Diffs Panel */}
                                            {isExpanded && hasChanges && (
                                                <tr>
                                                    <td colSpan={7} className="px-12 py-4 bg-gray-50/50 border-t border-b border-gray-100">
                                                        <div className="max-w-3xl bg-white p-5 rounded-2xl border border-gray-200/60 shadow-sm animate-in slide-in-from-top duration-300">
                                                            <div className="flex items-center gap-2 mb-3">
                                                                <Info className="w-4 h-4 text-blue-500" />
                                                                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider">Field Diff Details</h4>
                                                            </div>
                                                            <div className="overflow-hidden border border-gray-100 rounded-xl">
                                                                <table className="w-full text-left text-xs">
                                                                    <thead>
                                                                        <tr className="bg-gray-50 border-b border-gray-100">
                                                                            <th className="px-4 py-2 text-[10px] font-bold text-gray-500 uppercase">Field</th>
                                                                            <th className="px-4 py-2 text-[10px] font-bold text-gray-500 uppercase">Old Value</th>
                                                                            <th className="px-4 py-2 text-[10px] font-bold text-gray-500 uppercase">New Value</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-gray-50 font-mono text-[11px]">
                                                                        {Object.entries(parsedChanges).map(([field, val]: [string, any]) => {
                                                                            const oldVal = val && val.old !== undefined ? val.old : 'N/A';
                                                                            const newVal = val && val.new !== undefined ? val.new : 'N/A';
                                                                            return (
                                                                                <tr key={field} className="hover:bg-gray-50/40">
                                                                                    <td className="px-4 py-2 font-bold text-gray-600">{field}</td>
                                                                                    <td className="px-4 py-2 text-red-600 bg-red-50/30 line-through truncate max-w-xs">
                                                                                        {oldVal === null || oldVal === undefined ? 'null' : String(oldVal)}
                                                                                    </td>
                                                                                    <td className="px-4 py-2 text-emerald-600 bg-emerald-50/30 font-semibold truncate max-w-xs">
                                                                                        {newVal === null || newVal === undefined ? 'null' : String(newVal)}
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                            {log.details && (
                                                                <p className="mt-3 text-[11px] text-gray-500 italic">
                                                                    Summary: "{log.details}"
                                                                </p>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
