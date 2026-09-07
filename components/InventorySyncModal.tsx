/**
 * InventorySyncModal.tsx
 *
 * Premium inventory synchronisation upload modal supporting SAP and Oracle
 * Excel export formats. Features:
 *   - Animated drag-and-drop upload zone
 *   - Plant selector dropdown
 *   - Instant client-side format detection badge (SAP / Oracle / Unknown)
 *   - Animated progress bar during upload
 *   - Colour-coded ingestion summary result card
 *   - Micro-animations throughout (fade, slide, scale)
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  X, Upload, CheckCircle2, AlertTriangle, RefreshCw, FileSpreadsheet,
  Building2, Zap, Database, Plus, ArrowRight, Info, TrendingUp, SkipForward,
} from 'lucide-react';
import { detectPlantAndFormat } from '../services/inventorySyncService';
import { uploadInventorySync, IngestionSummary } from '../services/apiService';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Plant {
  id: string;
  name: string;
}

interface InventorySyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncComplete: () => void;   // called after a successful sync to refresh parts list
  currentUsername: string;
  plants: Plant[];
}

// ---------------------------------------------------------------------------
// Format badge colours
// ---------------------------------------------------------------------------

const FORMAT_STYLES = {
  SAP:     { bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-300',   dot: 'bg-blue-500',   label: 'SAP ERP' },
  ORACLE:  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300', dot: 'bg-emerald-500', label: 'Oracle ERP' },
  UNKNOWN: { bg: 'bg-slate-100',  text: 'text-slate-600',  border: 'border-slate-300',  dot: 'bg-slate-400',  label: 'Unknown Format' },
};

// ---------------------------------------------------------------------------
// Sub-component: Stat card in the ingestion summary
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
  bgClass: string;
  borderClass: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, colorClass, bgClass, borderClass }) => (
  <div className={`flex flex-col items-center justify-center p-4 rounded-2xl border ${bgClass} ${borderClass} gap-1.5`}>
    <div className={`${colorClass} mb-0.5`}>{icon}</div>
    <span className={`text-2xl font-black ${colorClass}`}>{value.toLocaleString()}</span>
    <span className="text-[11px] font-semibold text-slate-500 text-center leading-tight">{label}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type UploadPhase = 'idle' | 'file-selected' | 'uploading' | 'success' | 'error';

export const InventorySyncModal: React.FC<InventorySyncModalProps> = ({
  isOpen,
  onClose,
  onSyncComplete,
  currentUsername,
  plants,
}) => {
  const [selectedFile, setSelectedFile]       = useState<File | null>(null);
  const [selectedPlant, setSelectedPlant]     = useState<string>(plants[0]?.id ?? '');
  const [detectedFormat, setDetectedFormat]   = useState<'SAP' | 'ORACLE' | 'UNKNOWN' | null>(null);
  const [detectedPlantName, setDetectedPlantName] = useState<string | null>(null);
  const [phase, setPhase]                     = useState<UploadPhase>('idle');
  const [progress, setProgress]               = useState<number>(0);
  const [summary, setSummary]                 = useState<IngestionSummary | null>(null);
  const [errorMsg, setErrorMsg]               = useState<string>('');
  const [isDragging, setIsDragging]           = useState<boolean>(false);
  const fileInputRef                          = useRef<HTMLInputElement>(null);

  // Detect format on file selection
  const handleFile = useCallback((file: File) => {
    setSelectedFile(file);
    setPhase('file-selected');
    setSummary(null);
    setErrorMsg('');
    setDetectedFormat(null);
    setDetectedPlantName(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const detection = detectPlantAndFormat(workbook, selectedPlant);
        setDetectedFormat(detection.format);
        setDetectedPlantName(detection.plantId);
        if (detection.plantId) {
          const matchedPlant = plants.find(p => p.id === detection.plantId || p.name === detection.plantId);
          if (matchedPlant) {
            setSelectedPlant(matchedPlant.id);
          }
        }
      } catch {
        setDetectedFormat('UNKNOWN');
      }
    };
    reader.readAsArrayBuffer(file);
  }, [selectedPlant, plants]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';  // reset so same file can be reselected
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      handleFile(file);
    }
  };

  const handleDragOver  = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  // Upload
  const handleUpload = async () => {
    if (!selectedFile || !selectedPlant) return;
    setPhase('uploading');
    setProgress(0);

    // Simulate progress animation (actual work is synchronous on server)
    const ticker = setInterval(() => {
      setProgress(p => {
        if (p >= 88) { clearInterval(ticker); return 88; }
        return p + Math.random() * 12;
      });
    }, 180);

    try {
      const result = await uploadInventorySync(selectedFile, selectedPlant, currentUsername);
      clearInterval(ticker);
      setProgress(100);
      setSummary(result);
      setPhase('success');
      onSyncComplete();
    } catch (err: any) {
      clearInterval(ticker);
      setErrorMsg(err.message || 'An unknown error occurred during upload.');
      setPhase('error');
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setDetectedFormat(null);
    setPhase('idle');
    setProgress(0);
    setSummary(null);
    setErrorMsg('');
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  if (!isOpen) return null;

  const fmtStyle = detectedFormat ? FORMAT_STYLES[detectedFormat] : null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(8,12,28,0.72)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="relative w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          background: 'linear-gradient(145deg, #0f172a 0%, #1e293b 100%)',
          border: '1px solid rgba(99,102,241,0.25)',
          boxShadow: '0 0 80px rgba(99,102,241,0.18), 0 25px 60px rgba(0,0,0,0.5)',
          maxHeight: '92vh',
        }}
      >
        {/* ── Top accent bar ── */}
        <div
          className="h-1 w-full"
          style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #06b6d4)' }}
        />

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className="p-2.5 rounded-xl"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}
            >
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white tracking-tight">Inventory Sync</h2>
              <p className="text-xs text-slate-400 font-medium">SAP &amp; Oracle auto-detection</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-6 space-y-5">

          {/* ── Plant Selector ── */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> Target Plant
            </label>
            <select
              value={selectedPlant}
              onChange={e => setSelectedPlant(e.target.value)}
              disabled={phase === 'uploading'}
              className="w-full px-4 py-3 rounded-xl text-sm font-semibold text-white border border-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all disabled:opacity-60"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              {plants.map(p => (
                <option key={p.id} value={p.id} style={{ background: '#1e293b', color: '#fff' }}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* ── Drop Zone ── */}
          {(phase === 'idle' || phase === 'file-selected') && (
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5" /> Excel File
              </label>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className="relative cursor-pointer rounded-2xl transition-all duration-200 overflow-hidden"
                style={{
                  border: `2px dashed ${isDragging ? '#6366f1' : 'rgba(99,102,241,0.35)'}`,
                  background: isDragging ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)',
                  boxShadow: isDragging ? '0 0 0 4px rgba(99,102,241,0.15)' : 'none',
                  padding: '28px 24px',
                }}
              >
                {/* Animated shimmer on drag */}
                {isDragging && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.08), transparent)',
                      animation: 'shimmer 1.2s infinite',
                    }}
                  />
                )}

                {!selectedFile ? (
                  <div className="text-center">
                    <div
                      className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                      style={{ background: 'rgba(99,102,241,0.15)' }}
                    >
                      <Upload className="w-7 h-7 text-indigo-400" />
                    </div>
                    <p className="text-sm font-bold text-slate-300">Drop your SAP or Oracle export here</p>
                    <p className="text-xs text-slate-500 mt-1">or <span className="text-indigo-400 underline">click to browse</span></p>
                    <p className="text-[11px] text-slate-600 mt-3">.xlsx or .xls files only</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div
                      className="p-3 rounded-xl flex-shrink-0"
                      style={{ background: 'rgba(99,102,241,0.18)' }}
                    >
                      <FileSpreadsheet className="w-6 h-6 text-indigo-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white truncate">{selectedFile.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {(selectedFile.size / 1024).toFixed(1)} KB — click to change
                      </p>
                    </div>
                    {fmtStyle && (
                      <div
                        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${fmtStyle.bg} ${fmtStyle.text} ${fmtStyle.border}`}
                        style={{ transition: 'all 0.3s' }}
                      >
                        <span className={`w-2 h-2 rounded-full ${fmtStyle.dot}`} />
                        {fmtStyle.label}
                      </div>
                    )}
                    {detectedFormat === null && (
                      <div className="flex-shrink-0 text-slate-400">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleInputChange}
              />
            </div>
          )}

          {/* ── Unknown format warning ── */}
          {detectedFormat === 'UNKNOWN' && phase === 'file-selected' && (
            <div
              className="flex items-start gap-3 px-4 py-3 rounded-xl border"
              style={{ background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)' }}
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-300">Format not recognised</p>
                <p className="text-[11px] text-amber-400/80 mt-0.5">
                  Expected an SAP "Current Inventory Status" or Oracle "GS …" export. The file may still upload if the server can identify it.
                </p>
              </div>
            </div>
          )}

          {/* ── Format info pills ── */}
          {phase === 'idle' && (
            <div className="grid grid-cols-2 gap-3">
              {(['SAP', 'ORACLE'] as const).map(fmt => {
                const s = FORMAT_STYLES[fmt];
                return (
                  <div
                    key={fmt}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${s.bg} ${s.border}`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
                    <div>
                      <p className={`text-xs font-bold ${s.text}`}>{s.label}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {fmt === 'SAP' ? '"Current Inventory Status"' : '"GS Month Year"'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Progress bar (uploading phase) ── */}
          {phase === 'uploading' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-slate-400 font-semibold mb-1.5">
                    <span>Syncing inventory…</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${progress}%`,
                        background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #06b6d4)',
                      }}
                    />
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-500 text-center">
                Parsing rows, detecting format, and performing batch upsert…
              </p>
            </div>
          )}

          {/* ── Success / Summary card ── */}
          {phase === 'success' && summary && (
            <div
              className="rounded-2xl overflow-hidden border"
              style={{ border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.06)' }}
            >
              {/* Summary header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-emerald-500/20">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <div className="flex-1">
                  <p className="text-sm font-black text-emerald-300">Sync Complete</p>
                  <p className="text-[11px] text-slate-400">
                    {summary.source} export → {summary.plant}
                  </p>
                </div>
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold
                    ${FORMAT_STYLES[summary.source]?.bg ?? 'bg-slate-800'}
                    ${FORMAT_STYLES[summary.source]?.text ?? 'text-slate-300'}
                    ${FORMAT_STYLES[summary.source]?.border ?? 'border-slate-600'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${FORMAT_STYLES[summary.source]?.dot ?? 'bg-slate-400'}`} />
                  {FORMAT_STYLES[summary.source]?.label ?? summary.source}
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3 p-4">
                <StatCard
                  label="Total Rows Read"
                  value={summary.total_rows_read}
                  icon={<Database className="w-4 h-4" />}
                  colorClass="text-indigo-400"
                  bgClass="bg-indigo-500/10"
                  borderClass="border-indigo-500/25"
                />
                <StatCard
                  label="New Items Added"
                  value={summary.new_items_added}
                  icon={<Plus className="w-4 h-4" />}
                  colorClass="text-emerald-400"
                  bgClass="bg-emerald-500/10"
                  borderClass="border-emerald-500/25"
                />
                <StatCard
                  label="Items Updated"
                  value={summary.items_updated}
                  icon={<TrendingUp className="w-4 h-4" />}
                  colorClass="text-sky-400"
                  bgClass="bg-sky-500/10"
                  borderClass="border-sky-500/25"
                />
                <StatCard
                  label="Rows Skipped"
                  value={summary.skipped_rows}
                  icon={<SkipForward className="w-4 h-4" />}
                  colorClass="text-amber-400"
                  bgClass="bg-amber-500/10"
                  borderClass="border-amber-500/25"
                />
              </div>
            </div>
          )}

          {/* ── Error card ── */}
          {phase === 'error' && (
            <div
              className="flex items-start gap-3 px-4 py-4 rounded-2xl border"
              style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)' }}
            >
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-300">Sync Failed</p>
                <p className="text-xs text-red-400/80 mt-1 leading-relaxed">{errorMsg}</p>
              </div>
            </div>
          )}

          {/* ── Format help note ── */}
          {phase !== 'uploading' && phase !== 'success' && (
            <div
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
              style={{ background: 'rgba(99,102,241,0.07)' }}
            >
              <Info className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Format is auto-detected from the sheet name and column headers.
                Existing items are updated; new items are inserted. No duplicate rows are created.
              </p>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="px-6 py-4 flex items-center justify-end gap-3 border-t"
          style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
        >
          {phase === 'success' ? (
            <>
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" /> Upload Another
              </button>
              <button
                onClick={handleClose}
                className="px-5 py-2.5 text-sm font-bold text-white rounded-xl flex items-center gap-2 transition-all"
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                Done <CheckCircle2 className="w-4 h-4" />
              </button>
            </>
          ) : phase === 'error' ? (
            <>
              <button onClick={handleReset} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">
                Try Again
              </button>
              <button onClick={handleClose} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">
                Close
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleClose}
                disabled={phase === 'uploading'}
                className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={!selectedFile || !selectedPlant || phase === 'uploading'}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  boxShadow: selectedFile && selectedPlant ? '0 4px 18px rgba(99,102,241,0.45)' : 'none',
                }}
              >
                {phase === 'uploading' ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Syncing…</>
                ) : (
                  <><Upload className="w-4 h-4" /> Sync Inventory <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </>
          )}
        </div>

        {/* Shimmer keyframe — injected inline for portability */}
        <style>{`
          @keyframes shimmer {
            0%   { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}</style>
      </div>
    </div>
  );
};

export default InventorySyncModal;
