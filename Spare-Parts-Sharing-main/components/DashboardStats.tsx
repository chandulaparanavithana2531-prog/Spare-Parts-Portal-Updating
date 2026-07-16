import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { SparePart, FactorySummary } from '../types';
import { Package, DollarSign, Activity } from 'lucide-react';

interface DashboardStatsProps {
  parts: SparePart[];
  onFilterChange: (type: 'factory' | 'criticality', value: string) => void;
}

// Consistent color mapping for the 4 specific factories
const FACTORY_COLORS: Record<string, string> = {
  'Lanka Tiles': '#2563eb',       // Blue-600
  'Lanka Wall Tiles': '#059669',  // Emerald-600
  'Rocell Horana': '#d97706',     // Amber-600
  'Rocell Eheliyagoda': '#7c3aed' // Violet-600
};

// Hardcoded list to ensure fixed order on dashboard
const FACTORY_ORDER = [
  { name: 'Lanka Tiles', short: 'LT' },
  { name: 'Lanka Wall Tiles', short: 'LWT' },
  { name: 'Rocell Horana', short: 'RCLH' },
  { name: 'Rocell Eheliyagoda', short: 'RCLE' }
];

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

export const DashboardStats: React.FC<DashboardStatsProps> = ({ parts, onFilterChange }) => {
  // Aggregate data by factory (Memoized for performance)
  const { factoryData, totalValue, totalItems } = useMemo(() => {
    // 1. Initialize map with all factories set to 0 to ensure chart stability
    const factoryMap = new Map<string, FactorySummary & { shortName: string }>();

    FACTORY_ORDER.forEach(f => {
      factoryMap.set(f.name, {
        id: f.name,
        name: f.name,
        shortName: f.short,
        totalItems: 0,
        totalValue: 0,
        skuCount: 0
      });
    });

    // 2. Aggregate data
    parts.forEach(part => {
      // If a part belongs to a factory not in our main list (unlikely), add it dynamically
      if (!factoryMap.has(part.factoryId)) {
        factoryMap.set(part.factoryId, {
          id: part.factoryId,
          name: part.factoryId,
          shortName: part.factoryId.substring(0, 2).toUpperCase(),
          totalItems: 0,
          totalValue: 0,
          skuCount: 0
        });
      }

      const existing = factoryMap.get(part.factoryId)!;
      existing.totalItems += part.onHand;
      existing.totalValue += part.totalValue;
      existing.skuCount += 1;
    });

    const data = Array.from(factoryMap.values());
    const val = data.reduce((acc, curr) => acc + curr.totalValue, 0);
    const items = parts.length;

    return { factoryData: data, totalValue: val, totalItems: items };
  }, [parts]);

  // Format currency
  const formatCurrency = (val: number) => {
    return `Rs. ${new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 }).format(val)}`;
  };

  const getFactoryColor = (name: string, index: number) => {
    return FACTORY_COLORS[name] || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  };

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="relative overflow-hidden bg-white/70 backdrop-blur-xl p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/40 hover:shadow-[0_20px_40px_rgba(37,99,235,0.08)] transition-all duration-500 group">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors duration-500"></div>
          <div className="relative flex items-center justify-between">
            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-1">Total Stock Value</h3>
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
            <span className="text-[10px] text-gray-400 font-medium">Real-time consolidated data</span>
          </div>
        </div>

        <div className="relative overflow-hidden bg-white/70 backdrop-blur-xl p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/40 hover:shadow-[0_20px_40px_rgba(16,185,129,0.08)] transition-all duration-500 group">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl group-hover:bg-emerald-500/10 transition-colors duration-500"></div>
          <div className="relative flex items-center justify-between">
            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-1">Total SKU Count</h3>
              <div className="text-4xl font-black text-gray-900 tracking-tight">{totalItems.toLocaleString()}</div>
            </div>
            <div className="p-4 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl shadow-lg shadow-emerald-200 group-hover:scale-110 transition-transform duration-500">
              <Package className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full uppercase tracking-wider border border-emerald-100/50 shadow-sm">
              Current Stock
            </span>
            <span className="text-[10px] text-gray-400 font-medium">Across {factoryData.length} factories</span>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Plant-wise Total Value */}
        <div className="bg-white/80 backdrop-blur-md p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg font-black text-gray-800 tracking-tight">Plant-wise Total Value</h3>
            <div className="px-3 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-gray-500 uppercase">Snapshot</div>
          </div>
          
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={useMemo(() => {
                  return [...factoryData].sort((a, b) => b.totalValue - a.totalValue);
                }, [factoryData])}
                margin={{ top: 0, right: 80, left: 40, bottom: 0 }}
                barSize={32}
                onClick={(data) => {
                  if (data && data.activePayload && data.activePayload.length > 0) {
                    onFilterChange('factory', data.activePayload[0].payload.name);
                  }
                }}
              >
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  fontSize={10} 
                  width={120} 
                  tick={{ fill: '#64748b', fontWeight: 700 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip 
                  cursor={{ fill: 'rgba(241, 245, 249, 0.5)' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', background: '#fff' }}
                  formatter={(val: number) => [formatCurrency(val), 'Total Value']}
                />
                <Bar dataKey="totalValue" radius={[0, 12, 12, 0]} className="cursor-pointer">
                  {factoryData.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={getFactoryColor(entry.name, i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-gray-400 text-center font-bold uppercase tracking-widest mt-4">Click bars to filter inventory</p>
        </div>

        {/* Criticality Breakdown */}
        <div className="bg-white/80 backdrop-blur-md p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 flex flex-col">
          <h3 className="text-lg font-black text-gray-800 tracking-tight mb-8">Criticality Breakdown</h3>
          <div className="relative flex-1 flex items-center justify-center">
            {/* Center Summary */}
            <div className="absolute flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total SKU</span>
              <span className="text-3xl font-black text-gray-900">{totalItems.toLocaleString()}</span>
            </div>
            
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={useMemo(() => {
                    const critMap = new Map<string, number>();
                    // Initialize with 0 to ensure they appear in order
                    ['Vital', 'Essential', 'Desirable', 'Non Using'].forEach(c => critMap.set(c, 0));
                    
                    parts.forEach(p => {
                      const raw = (p.criticality || '').trim().toLowerCase();
                      const rawDesc = (p.description || '').trim().toLowerCase();
                      
                      let crit = 'Other';
                      // Detect "Non Using" first as it might be a status
                      if (raw.includes('non') || raw.includes('unused') || rawDesc.includes('non using')) {
                        crit = 'Non Using';
                      } else if (raw.includes('vita')) {
                        crit = 'Vital';
                      } else if (raw.includes('essen')) {
                        crit = 'Essential';
                      } else if (raw.includes('desir') || raw.includes('norm')) {
                        crit = 'Desirable';
                      }
                      
                      critMap.set(crit, (critMap.get(crit) || 0) + 1);
                    });
                    return Array.from(critMap.entries())
                      .filter(([name, count]) => count > 0 || ['Vital', 'Essential', 'Desirable', 'Non Using'].includes(name))
                      .map(([name, count]) => ({ name, count }));
                  }, [parts])}
                  dataKey="count"
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
                      onFilterChange('criticality', data.name);
                    }
                  }}
                >
                  {useMemo(() => {
                    const colors: Record<string, string> = {
                      'Vital': '#ef4444',      // Red
                      'Essential': '#f59e0b',  // Amber
                      'Desirable': '#10b981',  // Emerald
                      'Non Using': '#6366f1',  // Indigo/Blue
                      'Other': '#94a3b8'       // Slate
                    };
                    
                    const critMap = new Map<string, number>();
                    ['Vital', 'Essential', 'Desirable', 'Non Using'].forEach(c => critMap.set(c, 0));
                    parts.forEach(p => {
                      const raw = (p.criticality || '').trim().toLowerCase();
                      const rawDesc = (p.description || '').trim().toLowerCase();
                      
                      let crit = 'Other';
                      if (raw.includes('non') || raw.includes('unused') || rawDesc.includes('non using')) {
                        crit = 'Non Using';
                      } else if (raw.includes('vita')) {
                        crit = 'Vital';
                      } else if (raw.includes('essen')) {
                        crit = 'Essential';
                      } else if (raw.includes('desir') || raw.includes('norm')) {
                        crit = 'Desirable';
                      }
                      critMap.set(crit, (critMap.get(crit) || 0) + 1);
                    });

                    return Array.from(critMap.entries())
                      .filter(([name, count]) => count > 0 || ['Vital', 'Essential', 'Desirable', 'Non Using'].includes(name))
                      .map(([name], index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={colors[name] || '#94a3b8'} 
                        />
                      ));
                  }, [parts])}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', background: '#fff' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center flex-wrap gap-4 mt-8">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-red-600 px-4 py-2 bg-red-50 rounded-xl border border-red-100">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
              Vital
            </div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-amber-600 px-4 py-2 bg-amber-50 rounded-xl border border-amber-100">
              <div className="w-2 h-2 rounded-full bg-amber-500"></div>
              Essential
            </div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-emerald-600 px-4 py-2 bg-emerald-50 rounded-xl border border-emerald-100">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              Desirable
            </div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-indigo-600 px-4 py-2 bg-indigo-50 rounded-xl border border-indigo-100">
              <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
              Non Using
            </div>
          </div>
          <p className="text-[10px] text-gray-400 text-center font-bold uppercase tracking-widest mt-4">Click slices to filter inventory</p>
        </div>
      </div>
    </div>
  );
};