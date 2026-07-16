import React from 'react';
import { X, CheckCircle2, AlertTriangle, FileText, Database, ArrowRight } from 'lucide-react';
import { ExcelParseResult } from '../services/excelService';

interface UploadPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  result: ExcelParseResult;
  isUploading: boolean;
}

export const UploadPreviewModal: React.FC<UploadPreviewModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  result,
  isUploading
}) => {
  if (!isOpen) return null;

  const { metadata } = result;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Upload Preview</h3>
              <p className="text-xs text-gray-500 font-medium">{metadata.fileName}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
              <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Total Rows</span>
              <p className="text-2xl font-black text-blue-900 mt-1">{metadata.totalRows}</p>
            </div>
            <div className="p-4 bg-green-50 rounded-xl border border-green-100">
              <span className="text-xs font-bold text-green-600 uppercase tracking-wider">Valid Parts</span>
              <p className="text-2xl font-black text-green-900 mt-1">{metadata.validItems}</p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Warnings/Stats */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="p-1.5 bg-orange-100 text-orange-600 rounded">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Collision Detection</p>
                <p className="text-xs text-gray-600 mt-1">
                  <span className="font-bold text-orange-600">{metadata.totalCollisions}</span> items have duplicate Material Numbers and will be merged/overwritten.
                </p>
              </div>
            </div>

            {metadata.filteredItems > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-100">
                <div className="p-1.5 bg-red-100 text-red-600 rounded">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-red-900">Data Quality</p>
                  <p className="text-xs text-red-700 mt-1">
                    <span className="font-bold">{metadata.filteredItems}</span> rows were skipped because they missing a "Material Number".
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-3 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
            <div className="flex items-center gap-2 text-indigo-700">
              <Database className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Target Factory</span>
            </div>
            <p className="text-sm font-medium text-indigo-900 mt-1">{metadata.factoryId}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isUploading || metadata.validItems === 0}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold rounded-xl hover:shadow-lg hover:shadow-blue-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isUploading ? 'Uploading...' : 'Confirm & Upload'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
