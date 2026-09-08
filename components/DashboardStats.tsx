import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import { SparePart, User, FactorySummary } from '../types';
import { Package, DollarSign, Activity, CheckCircle, AlertTriangle, Layers, Building2, EyeOff } from 'lucide-react';

interface DashboardStatsProps {
  parts: SparePart[];
  onFilterChange: (type: 'factory' | 'criticality' | 'fsn', value: string) => void;
  currentUser: User;
}

const FACTORY_COLORS: Record<string, string> = {
  'Lanka Tiles': '#2563eb',       // Blue-600
  'Lanka Wall Tiles': '#059669',  // Emerald-600
  'Rocell Horana': '#d97706',     // Amber-600
  'Rocell Eheliyagoda': '#7c3aed' // Violet-600
};

const FACTORY_ORDER = [
  { name: 'Lanka Tiles', short: 'LT' },
  { name: 'Lanka Wall Tiles', short: 'LWT' },
  { name: 'Rocell Horana', short: 'RCLH' },
  { name: 'Rocell Eheliyagoda', short: 'RCLE' }
];

const FSN_COLORS = {
  'Fast': '#10b981',       // Green
  'Slow': '#f59e0b',       // Amber
  'Non-moving': '#ef4444', // Red
  'Unknown': '#94a3b8'     // Slate
};

export const DashboardStats: React.FC<DashboardStatsProps> = ({ parts, onFilterChange, currentUser }) => {
  // 1. Establish Active Factory Scope (RBAC Control)
  const isUserAdmin = currentUser.role === 'admin';
  const initialFactory = isUserAdmin ? 'all' : (currentUser.factoryAffiliation || 'Lanka Tiles');
  const [activeFactory, setActiveFactory] = useState<string>(initialFactory);
  const [reconData, setReconData] = useState<any>(null);
  const [showReconModal, setShowReconModal] = useState(false);

  // If currentUser factory affiliation changes, force state update
  useEffect(() => {
    if (!isUserAdmin && currentUser.factoryAffiliation) {
      setActiveFactory(currentUser.factoryAffiliation);
    }
  }, [currentUser, isUserAdmin]);

  // 2. Fetch Google Sheets Reconciliation Data
  useEffect(() => {
    const fetchReconciliation = async () => {
      try {
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const headers: Record<string, string> = {};
        if (currentUser && currentUser.factoryAffiliation) {
          headers['x-factory-affiliation'] = currentUser.factoryAffiliation;
        }
        const res = await fetch(`${baseUrl}/api/reconciliation-status`, { headers });
        if (res.ok) {
          const data = await res.json();
          setReconData(data);
        }
      } catch (err) {
        console.warn("[Dashboard Stats] Failed to load reconciliation data:", err);
      }
    };
    fetchReconciliation();
  }, [parts, currentUser]);

  // 3. Filter parts dynamically based on active factory scope
  const scopedParts = useMemo(() => {
    if (activeFactory === 'all') {
      return parts;
    }
    return parts.filter(p => p.factoryId === activeFactory);
  }, [parts, activeFactory]);

  // 4. Calculate aggregates for FSN and KPIs
  const { totalValue, totalItems, fsnData, factoryBreakdown } = useMemo(() => {
    let sumValue = 0;
    let sumItems = 0;
    
    const fsnCounts = { 'Fast': 0, 'Slow': 0, 'Non-moving': 0 };
    const fsnValues = { 'Fast': 0, 'Slow': 0, 'Non-moving': 0 };
    
    const factoryMap = new Map<string, { skus: number; value: number }>();
    FACTORY_ORDER.forEach(f => factoryMap.set(f.name, { skus: 0, value: 0 }));

    scopedParts.forEach(part => {
      const qty = Number(part.onHand) || 0;
      const val = Number(part.totalValue) || 0;

      sumItems += qty;
      sumValue += val;

      // FSN Aggregates
      const fsnClass = part.fsnClassification || 'Non-moving';
      if (fsnCounts[fsnClass] !== undefined) {
        fsnCounts[fsnClass]++;
        fsnValues[fsnClass] += val;
      }

      // Factory Aggregates
      if (!factoryMap.has(part.factoryId)) {
        factoryMap.set(part.factoryId, { skus: 0, value: 0 });
      }
      const fData = factoryMap.get(part.factoryId)!;
      fData.skus++;
      fData.value += val;
    });

    const fsnChart = Object.keys(fsnCounts).map(key => ({
      name: key,
      value: fsnCounts[key as keyof typeof fsnCounts],
      financial: fsnValues[key as keyof typeof fsnValues]
    }));

    return {
      totalValue: sumValue,
      totalItems: scopedParts.length, // Distinct SKU count in active view
      fsnData: fsnChart,
      factoryBreakdown: Array.from(factoryMap.entries()).map(([name, stats]) => ({
        name,
        skus: stats.skus,
        value: stats.value
      }))
    };
  }, [scopedParts]);

  const formatCurrency = (val: number) => {
    return `Rs. ${new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 }).format(val)}`;
  };

  return (
    <div className="space-y-8">
      {/* 1. Header with RBAC Switcher and Reconciliation Status Badge */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/50 backdrop-blur-md p-6 rounded-3xl border border-white/60 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-gray-800 tracking-tight">Consolidated Analytics</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {activeFactory === 'all' ? 'Consolidated view across all 4 plants' : `Isolated view for ${activeFactory}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Visual Reconciliation status badge */}
          {reconData?.success && (
            <div 
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer hover:scale-105 transition-all shadow-sm
                ${reconData.isMatched 
                  ? 'bg-green-50 text-green-700 border-green-200' 
                  : 'bg-amber-50 text-amber-700 border-amber-200'}`}
              onClick={() => setShowReconModal(true)}
              title="Click for full Reconciliation Report"
            >
              {reconData.isMatched ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                  <span>Data Synced: 100% Matched</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Sync Mismatch ({reconData.percentageMatched}% Matched)</span>
                </>
              )}
            </div>
          )}

          {/* Plant Isolator Tabs (Hidden for regular users) */}
          {isUserAdmin ? (
            <div className="flex bg-gray-100 p-1.5 rounded-2xl border border-gray-200/50 shadow-inner">
              <button
                onClick={() => setActiveFactory('all')}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${activeFactory === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                All BUs
              </button>
              {FACTORY_ORDER.map(f => (
                <button
                  key={f.name}
                  onClick={() => setActiveFactory(f.name)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${activeFactory === f.name ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {f.short}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 text-xs font-bold border border-blue-100">
              <Building2 className="w-4 h-4 text-blue-600" />
              <span>Plant Scoped: {activeFactory}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="relative overflow-hidden bg-white/70 backdrop-blur-xl p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/40 hover:shadow-[0_20px_40px_rgba(37,99,235,0.08)] transition-all duration-500 group">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors duration-500"></div>
          <div className="relative flex items-center justify-between">
            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-1">Stock Valuation</h3>
              <div className="text-4xl font-black text-gray-900 tracking-tight" title={formatCurrency(totalValue)}>
                {formatCurrency(totalValue)}
              </div>
            </div>
            <div className="p-4 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-lg shadow-blue-200 group-hover:scale-110 transition-transform duration-500">
              <DollarSign className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <span className="flex items-center text-[10px] font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full uppercase tracking-wider border border-blue-100/50 shadow-sm">
              <Activity className="w-3 h-3 mr-1" />
              Active Inventory
            </span>
            <span className="text-[10px] text-gray-400 font-medium">Consolidated live database values</span>
          </div>
        </div>

        <div className="relative overflow-hidden bg-white/70 backdrop-blur-xl p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/40 hover:shadow-[0_20px_40px_rgba(16,185,129,0.08)] transition-all duration-500 group">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl group-hover:bg-emerald-500/10 transition-colors duration-500"></div>
          <div className="relative flex items-center justify-between">
            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-1">SKU Count</h3>
              <div className="text-4xl font-black text-gray-900 tracking-tight">{totalItems.toLocaleString()}</div>
            </div>
            <div className="p-4 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl shadow-lg shadow-emerald-200 group-hover:scale-110 transition-transform duration-500">
              <Package className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full uppercase tracking-wider border border-emerald-100/50 shadow-sm">
              Current Catalog
            </span>
            <span className="text-[10px] text-gray-400 font-medium">Distinct items in active scope</span>
          </div>
        </div>
      </div>

      {/* 3. FSN Breakdown & Value Breakdown Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* FSN SKU Count Breakdown (Donut Chart) */}
        <div className="bg-white/80 backdrop-blur-md p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg font-black text-gray-800 tracking-tight">FSN SKU Classification</h3>
            <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-black uppercase tracking-wider">Breakdown</span>
          </div>
          
          <div className="relative flex-1 flex items-center justify-center min-h-[250px]">
            <div className="absolute flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total SKUs</span>
              <span className="text-3xl font-black text-gray-900">{totalItems.toLocaleString()}</span>
            </div>
            
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={fsnData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={75}
                  outerRadius={95}
                  paddingAngle={8}
                  stroke="none"
                  className="cursor-pointer"
                  onClick={(data) => {
                    if (data && data.name) {
                      onFilterChange('fsn', data.name);
                    }
                  }}
                >
                  {fsnData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={FSN_COLORS[entry.name as keyof typeof FSN_COLORS] || '#94a3b8'} 
                    />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', background: '#fff' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          
          <div className="flex justify-center flex-wrap gap-4 mt-8">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-green-600 px-4 py-2 bg-green-50 rounded-xl border border-green-100">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              Fast ({fsnData.find(d => d.name === 'Fast')?.value || 0})
            </div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-amber-600 px-4 py-2 bg-amber-50 rounded-xl border border-amber-100">
              <div className="w-2 h-2 rounded-full bg-amber-500"></div>
              Slow ({fsnData.find(d => d.name === 'Slow')?.value || 0})
            </div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-red-600 px-4 py-2 bg-red-50 rounded-xl border border-red-100">
              <div className="w-2 h-2 rounded-full bg-red-500"></div>
              Non-moving ({fsnData.find(d => d.name === 'Non-moving')?.value || 0})
            </div>
          </div>
          <p className="text-[10px] text-gray-400 text-center font-bold uppercase tracking-widest mt-4">Click slices to filter list by FSN</p>
        </div>

        {/* FSN Valuation Breakdown (Bar Chart) */}
        <div className="bg-white/80 backdrop-blur-md p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg font-black text-gray-800 tracking-tight">FSN Financial Valuation</h3>
            <span className="px-3 py-1 bg-purple-50 text-purple-600 rounded-lg text-[10px] font-black uppercase tracking-wider">Value</span>
          </div>

          {/* FSN Stats Grid */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-green-50 rounded-2xl border border-green-100 text-center">
              <span className="text-[10px] text-green-700 font-black uppercase tracking-wider">Fast Value</span>
              <div className="text-sm font-extrabold text-gray-900 mt-1">
                {formatCurrency(fsnData.find(d => d.name === 'Fast')?.financial || 0)}
              </div>
            </div>
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 text-center">
              <span className="text-[10px] text-amber-700 font-black uppercase tracking-wider">Slow Value</span>
              <div className="text-sm font-extrabold text-gray-900 mt-1">
                {formatCurrency(fsnData.find(d => d.name === 'Slow')?.financial || 0)}
              </div>
            </div>
            <div className="p-4 bg-red-50 rounded-2xl border border-red-100 text-center">
              <span className="text-[10px] text-red-700 font-black uppercase tracking-wider">Non-moving Value</span>
              <div className="text-sm font-extrabold text-gray-900 mt-1">
                {formatCurrency(fsnData.find(d => d.name === 'Non-moving')?.financial || 0)}
              </div>
            </div>
          </div>

          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={fsnData}
                margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
                barSize={40}
              >
                <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', background: '#fff' }}
                  formatter={(val: number) => [formatCurrency(val), 'Valuation']}
                />
                <Bar dataKey="financial" radius={[12, 12, 0, 0]}>
                  {fsnData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={FSN_COLORS[entry.name as keyof typeof FSN_COLORS] || '#94a3b8'} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-gray-400 text-center font-bold uppercase tracking-widest mt-4">Financial distribution per movement tier</p>
        </div>
      </div>

      {/* 4. Plant comparison stats for Administrators */}
      {activeFactory === 'all' && isUserAdmin && (
        <div className="bg-white/80 backdrop-blur-md p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60">
          <h3 className="text-lg font-black text-gray-800 tracking-tight mb-8">Plant-wise Comparative Analytics</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {factoryBreakdown.map((plant, idx) => (
              <div key={plant.name} className="p-5 rounded-2xl border border-gray-250 bg-gray-50 flex flex-col justify-between h-[120px]">
                <div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getFactoryColor(plant.name, idx) }}></div>
                    <span className="text-xs font-bold text-gray-700">{plant.name}</span>
                  </div>
                  <div className="text-2xl font-black text-gray-900 mt-2">{plant.skus} SKUs</div>
                </div>
                <div className="text-xs font-extrabold text-blue-600">{formatCurrency(plant.value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Custom Modal for Google Sheets Reconciliation Report */}
      {showReconModal && reconData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-white p-8 rounded-3xl max-w-2xl w-full border border-gray-100 shadow-2xl animate-in zoom-in-95 duration-200 space-y-6">
            <div className="flex justify-between items-center pb-4 border-b border-gray-150">
              <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-600" />
                Google Sheets Reconciliation Report
              </h3>
              <button 
                onClick={() => setShowReconModal(false)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition-all"
              >
                ✕
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-6 bg-blue-50/50 p-5 rounded-2xl border border-blue-100/50">
              <div>
                <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">Sheet Totals</span>
                <div className="text-2xl font-black text-gray-900 mt-1">{reconData.sheetTotals.skus.toLocaleString()} SKUs</div>
                <div className="text-sm font-extrabold text-blue-600">{formatCurrency(reconData.sheetTotals.value)}</div>
              </div>
              <div>
                <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">Portal Database Totals</span>
                <div className="text-2xl font-black text-gray-900 mt-1">{reconData.portalTotals.skus.toLocaleString()} SKUs</div>
                <div className="text-sm font-extrabold text-blue-600">{formatCurrency(reconData.portalTotals.value)}</div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-gray-500 uppercase">Breakdown per Plant</h4>
              <div className="border border-gray-150 rounded-2xl overflow-hidden divide-y divide-gray-150 text-xs">
          <div className="grid grid-cols-3 p-3 bg-gray-50 font-bold text-gray-600">
                  <div>Business Unit</div>
                  <div className="text-center">Google Sheet</div>
                  <div className="text-right">Portal DB</div>
                </div>
                {Object.keys(reconData.sheetTotals.breakdown)
                  .filter(factory => isUserAdmin || factory === currentUser.factoryAffiliation)
                  .map(factory => {
                  const sBU = reconData.sheetTotals.breakdown[factory];
                  const dBU = reconData.portalTotals.breakdown[factory] || { skus: 0, value: 0 };
                  const isMatch = sBU.skus === dBU.skus && Math.abs(sBU.value - dBU.value) < 1.0;
                  return (
                    <div key={factory} className="grid grid-cols-3 p-3 bg-white hover:bg-gray-50 transition-colors">
                      <div className="font-bold text-gray-700 flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${isMatch ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        {factory}
                      </div>
                      <div className="text-center text-gray-500">
                        {sBU.skus} SKUs | {formatCurrency(sBU.value)}
                      </div>
                      <div className={`text-right font-bold ${isMatch ? 'text-green-600' : 'text-amber-600'}`}>
                        {dBU.skus} SKUs | {formatCurrency(dBU.value)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-150">
              <div className="flex items-center gap-1 text-xs font-bold">
                Status: 
                <span className={reconData.isMatched ? 'text-green-600' : 'text-amber-600'}>
                  {reconData.isMatched ? '✅ 100% Synced & Verified' : '⚠️ Synced, Mismatch exists'}
                </span>
              </div>
              <button 
                onClick={() => setShowReconModal(false)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const getFactoryColor = (name: string, index: number) => {
  return FACTORY_COLORS[name] || '#94a3b8';
};