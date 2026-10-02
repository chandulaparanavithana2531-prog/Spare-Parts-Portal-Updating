import React, { useMemo, useState } from 'react';
import {
  X, ArrowRight, CheckCircle2, AlertTriangle, Plus, Search,
  TrendingUp, TrendingDown, Minus, Database, FileText, RefreshCw
} from 'lucide-react';
import { SparePart } from '../types';
import { SystemReportParseResult } from '../services/excelService';

interface SystemReportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isConfirming: boolean;
  parseResult: SystemReportParseResult;
  existingParts: SparePart[];
  factoryId: string;
}

export const SystemReportPreviewModal: React.FC<SystemReportPreviewModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isConfirming,
  parseResult,
  existingParts,
  factoryId,
}) => {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'matched' | 'new' | 'unmatched'>('matched');

  const isConsumption =
    parseResult.reportType === 'SAP_MB51' ||
    parseResult.reportType === 'ORACLE_TRANSACTION';

  const { matched, newParts, unmatched } = useMemo(() => {
    const matched: Array<{
      part: SparePart;
      incoming: Partial<SparePart>;
      newOnHand: number;
      delta: number;
    }> = [];
    const newParts: Array<Partial<SparePart>> = [];
    const unmatched: Array<SparePart> = [];

    // Build lookup map of incoming parts by materialNumber (normalized)
    const incomingMap = new Map<string, Partial<SparePart>>();
    parseResult.updatedParts.forEach(p => {
      if (p.materialNumber) {
        incomingMap.set(String(p.materialNumber).trim().toLowerCase(), p);
      }
    });

    // Factory parts
    const factoryParts = existingParts.filter(p => p.factoryId === factoryId);

    factoryParts.forEach(existing => {
      const key = String(existing.materialNumber).trim().toLowerCase();
      const incoming = incomingMap.get(key);
      if (incoming) {
        let newOnHand: number;
        if (isConsumption) {
          const consumed = incoming.qtyMoreThan3Years || 0;
          newOnHand = Math.max(0, existing.onHand - consumed);
        } else {
          newOnHand = incoming.onHand ?? existing.onHand;
        }
        matched.push({ part: existing, incoming, newOnHand, delta: newOnHand - existing.onHand });
        incomingMap.delete(key); // mark as consumed
      } else {
        // Part exists in DB but not in file — not affected
        // Only show in unmatched tab for stock reports (not consumption)
        if (!isConsumption) {
          unmatched.push(existing);
        }
      }
    });

    // Remaining incoming parts are new (not in DB)
    incomingMap.forEach(p => newParts.push(p));

    return { matched, newParts, unmatched };
  }, [parseResult, existingParts, factoryId, isConsumption]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return { matched, newParts, unmatched };

    return {
      matched: matched.filter(
        m =>
          m.part.materialNumber.toLowerCase().includes(q) ||
          m.part.description.toLowerCase().includes(q)
      ),
      newParts: newParts.filter(
        p =>
          String(p.materialNumber || '').toLowerCase().includes(q) ||
          String(p.description || '').toLowerCase().includes(q)
      ),
      unmatched: unmatched.filter(
        p =>
          p.materialNumber.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
      ),
    };
  }, [search, matched, newParts, unmatched]);

  if (!isOpen) return null;

  const reportLabel = isConsumption
    ? 'Consumption Deduction'
    : 'Stock Level Update';

  const DeltaBadge = ({ delta }: { delta: number }) => {
    if (delta === 0)
      return (
        <span className="flex items-center gap-1 text-gray-400 text-[10px] font-bold">
          <Minus className="w-3 h-3" /> No change
        </span>
      );
    if (delta > 0)
      return (
        <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-bold">
          <TrendingUp className="w-3 h-3" /> +{delta}
        </span>
      );
    return (
      <span className="flex items-center gap-1 text-red-500 text-[10px] font-bold">
        <TrendingDown className="w-3 h-3" /> {delta}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-xl">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Upload Preview</h3>
              <p className="text-xs text-gray-500 font-medium">
                {parseResult.metadata.reportName} · {factoryId} · {reportLabel}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-gray-100 shrink-0">
          <button
            onClick={() => setActiveTab('matched')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              activeTab === 'matched'
                ? 'bg-blue-50 border-blue-200 shadow-sm'
                : 'bg-gray-50 border-gray-100 hover:bg-gray-100'
            }`}
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Updated</span>
            <p className="text-2xl font-black text-blue-700 mt-0.5">{matched.length}</p>
            <p className="text-[10px] text-gray-500 font-semibold">parts will change</p>
          </button>
          <button
            onClick={() => setActiveTab('new')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              activeTab === 'new'
                ? 'bg-emerald-50 border-emerald-200 shadow-sm'
                : 'bg-gray-50 border-gray-100 hover:bg-gray-100'
            }`}
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">New</span>
            <p className="text-2xl font-black text-emerald-700 mt-0.5">{newParts.length}</p>
            <p className="text-[10px] text-gray-500 font-semibold">parts will be added</p>
          </button>
          <button
            onClick={() => setActiveTab('unmatched')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              activeTab === 'unmatched'
                ? 'bg-orange-50 border-orange-200 shadow-sm'
                : 'bg-gray-50 border-gray-100 hover:bg-gray-100'
            }`}
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Not in file</span>
            <p className="text-2xl font-black text-orange-600 mt-0.5">{unmatched.length}</p>
            <p className="text-[10px] text-gray-500 font-semibold">parts unchanged</p>
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-100 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by material number or description..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-300 transition-all"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {activeTab === 'matched' && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 z-10">
                <tr>
                  <th className="px-4 py-3 text-left font-black text-gray-400 uppercase tracking-wider">Material #</th>
                  <th className="px-4 py-3 text-left font-black text-gray-400 uppercase tracking-wider">Description</th>
                  <th className="px-4 py-3 text-right font-black text-gray-400 uppercase tracking-wider">Current</th>
                  <th className="px-4 py-3 text-center font-black text-gray-400 uppercase tracking-wider w-8"></th>
                  <th className="px-4 py-3 text-right font-black text-gray-400 uppercase tracking-wider">After Upload</th>
                  <th className="px-4 py-3 text-right font-black text-gray-400 uppercase tracking-wider">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.matched.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400 font-medium">
                      No matching parts found.
                    </td>
                  </tr>
                ) : (
                  filtered.matched.map(({ part, newOnHand, delta }) => (
                    <tr key={part.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                          {part.materialNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-semibold max-w-[200px] truncate">
                        {part.description}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-600">{part.onHand}</td>
                      <td className="px-4 py-3 text-center text-gray-300">
                        <ArrowRight className="w-4 h-4 mx-auto" />
                      </td>
                      <td className={`px-4 py-3 text-right font-black ${
                        delta < 0 ? 'text-red-600' : delta > 0 ? 'text-emerald-600' : 'text-gray-600'
                      }`}>
                        {newOnHand}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DeltaBadge delta={delta} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'new' && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 z-10">
                <tr>
                  <th className="px-4 py-3 text-left font-black text-gray-400 uppercase tracking-wider">Material #</th>
                  <th className="px-4 py-3 text-left font-black text-gray-400 uppercase tracking-wider">Description</th>
                  <th className="px-4 py-3 text-right font-black text-gray-400 uppercase tracking-wider">Stock (New)</th>
                  <th className="px-4 py-3 text-right font-black text-gray-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.newParts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-400 font-medium">
                      No new parts to add.
                    </td>
                  </tr>
                ) : (
                  filtered.newParts.map((p, i) => (
                    <tr key={i} className="hover:bg-emerald-50/40 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                          {p.materialNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-semibold max-w-[240px] truncate">
                        {p.description || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-black text-emerald-700">{p.onHand ?? 0}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                          <Plus className="w-3 h-3" /> New Entry
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'unmatched' && (
            <div className="p-4 space-y-2">
              <div className="flex items-start gap-3 p-3 bg-orange-50 border border-orange-100 rounded-xl mb-4">
                <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                <p className="text-xs text-orange-700 font-semibold">
                  These parts are in the portal inventory but <strong>not found in your uploaded file</strong>.
                  Their stock quantities will <strong>not be changed</strong>.
                </p>
              </div>
              {filtered.unmatched.length === 0 ? (
                <div className="text-center py-8 text-gray-400 font-medium text-xs">
                  All portal parts were matched in the uploaded file. ✓
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left font-black text-gray-400 uppercase tracking-wider">Material #</th>
                      <th className="px-4 py-3 text-left font-black text-gray-400 uppercase tracking-wider">Description</th>
                      <th className="px-4 py-3 text-right font-black text-gray-400 uppercase tracking-wider">Current Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.unmatched.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50/80 transition-colors opacity-60">
                        <td className="px-4 py-3">
                          <span className="font-black text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md">
                            {p.materialNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 font-semibold max-w-[240px] truncate">
                          {p.description}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-500">{p.onHand}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-500 font-semibold">
            <Database className="w-4 h-4 text-blue-500" />
            <span>
              {matched.length} updated · {newParts.length} new · {unmatched.length} unchanged
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={isConfirming}
              className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isConfirming || (matched.length === 0 && newParts.length === 0)}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold rounded-xl hover:shadow-lg hover:shadow-blue-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              {isConfirming ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Applying...</>
              ) : (
                <>Confirm & Apply <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
