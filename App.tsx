import React, { useState, useMemo, useEffect } from 'react';
import { Upload, Search, LayoutDashboard, SlidersHorizontal, Sparkles, CheckCircle, RefreshCw, Database, FileSpreadsheet, LogOut, ShoppingBag, ShoppingCart, Plus, Trash2, ShieldAlert, Sun, Moon, LogIn, Globe, ArrowRight, Menu } from 'lucide-react';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import { parseExcelFile, parseSystemReport } from './services/excelService';
import { SparePart, User, CartItem, HistoricalConsumptionRecord, UploadHistoryRecord } from './types';
import { saveInventory, getInventory, clearDatabase, deleteFactoryData, getOrders, getPendingUsers, saveSystemReport, saveHistoricalConsumption, getHistoricalConsumption, getUploadHistory, revertUpload } from './services/db';
import { fetchBackendParts, fetchBackendFactories, mergeAndDeduplicate, fetchHistoricalConsumption, uploadHistoricalConsumptionFile } from './services/apiService';
import { DashboardStats } from './components/DashboardStats';
import { InventoryTable } from './components/InventoryTable';
import materialImages from './material_images.json';
import { AIInsights } from './components/AIInsights';
import { ChatBot } from './components/ChatBot';
import { Login } from './components/Login';
import { OrderManagement } from './components/OrderManagement';
import { CartDrawer } from './components/CartDrawer';
import { AddItemModal } from './components/AddItemModal';
import { UserManagement } from './components/UserManagement'; // Import
import { Users } from 'lucide-react';
import { AuditLogs } from './components/AuditLogs';
import { UploadPreviewModal } from './components/UploadPreviewModal';
import { ExcelParseResult } from './services/excelService';

// Factory Configuration
const normalizeImageUrl = (url: string | undefined): string | undefined => {
  if (!url) return url;
  if (url.includes('drive.google.com')) {
    let id = '';
    const parts = url.split('/');
    const dIndex = parts.indexOf('d');
    if (dIndex !== -1 && parts.length > dIndex + 1) {
      id = parts[dIndex + 1];
    } else {
      const match = url.match(/[?&]id=([^&]+)/);
      if (match) {
        id = match[1];
      }
    }
    if (id) {
      id = id.split(/[&?]/)[0];
      return `https://lh3.googleusercontent.com/d/${id}`;
    }
  }
  return url;
};

const FACTORIES = [
  {
    id: 'Lanka Tiles',
    name: 'Lanka Tiles',
    theme: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: 'text-blue-600', hover: 'hover:border-blue-400' }
  },
  {
    id: 'Lanka Wall Tiles',
    name: 'Lanka Wall Tiles',
    theme: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: 'text-emerald-600', hover: 'hover:border-emerald-400' }
  },
  {
    id: 'Rocell Horana',
    name: 'Rocell Horana',
    theme: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: 'text-amber-600', hover: 'hover:border-amber-400' }
  },
  {
    id: 'Rocell Eheliyagoda',
    name: 'Rocell Eheliyagoda',
    theme: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', icon: 'text-purple-600', hover: 'hover:border-purple-400' }
  },
];

const DashboardConsumptionView: React.FC<{ parts: SparePart[]; historicalConsumption: HistoricalConsumptionRecord[] }> = ({ parts, historicalConsumption }) => {
  const [selectedFactory, setSelectedFactory] = useState<string>('All');

  // Filter only parts that have been consumed and match selection
  const consumedParts = parts.filter(p => (p.consumptionQty || 0) > 0 && (selectedFactory === 'All' || p.factoryId === selectedFactory));
  const filteredHistoricalConsumption = historicalConsumption.filter(r => selectedFactory === 'All' || r.factoryId === selectedFactory);

  // Split into SM and SE
  const smParts = consumedParts.filter(p => {
    const type = (p.spareType || '').trim().toUpperCase();
    return type === 'SM' || type.includes('MECHANICAL') || type === 'M' || type.includes('MECH');
  });

  const seParts = consumedParts.filter(p => {
    const type = (p.spareType || '').trim().toUpperCase();
    return type === 'SE' || type.includes('ELECTRICAL') || type === 'E' || type.includes('ELEC');
  });

  // Aggregate consumption data per plant (used for All Factories mode)
  const plantConsumption = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number; value: number }>();
    
    // Initialize standard factories to guarantee they display on the chart
    const factoriesList = ['Lanka Tiles', 'Lanka Wall Tiles', 'Rocell Horana', 'Rocell Eheliyagoda'];
    factoriesList.forEach(f => {
      map.set(f, { name: f, quantity: 0, value: 0 });
    });

    consumedParts.forEach(p => {
      if (!map.has(p.factoryId)) {
        map.set(p.factoryId, { name: p.factoryId, quantity: 0, value: 0 });
      }
      const entry = map.get(p.factoryId)!;
      entry.quantity += p.consumptionQty || 0;
      entry.value += p.consumptionValue || 0;
    });

    return Array.from(map.values());
  }, [consumedParts]);

  // Aggregate consumption data by Spare Type (used for single factory mode)
  const spareTypeConsumption = useMemo(() => {
    const mechanicalValue = smParts.reduce((acc, p) => acc + (p.consumptionValue || 0), 0);
    const mechanicalQty = smParts.reduce((acc, p) => acc + (p.consumptionQty || 0), 0);
    const electricalValue = seParts.reduce((acc, p) => acc + (p.consumptionValue || 0), 0);
    const electricalQty = seParts.reduce((acc, p) => acc + (p.consumptionQty || 0), 0);

    return [
      { name: 'Mechanical Spares', quantity: mechanicalQty, value: mechanicalValue },
      { name: 'Electrical Spares', quantity: electricalQty, value: electricalValue }
    ];
  }, [smParts, seParts]);

  const { totalConsQty, totalConsValue, highestConsPlant } = useMemo(() => {
    let q = 0;
    let v = 0;
    let maxV = -1;
    let maxPlant = 'None';
    plantConsumption.forEach(p => {
      q += p.quantity;
      v += p.value;
      if (p.value > maxV) {
        maxV = p.value;
        maxPlant = p.name;
      }
    });
    return { totalConsQty: q, totalConsValue: v, highestConsPlant: maxV > 0 ? maxPlant : 'None' };
  }, [plantConsumption]);

  // Aggregate and format 3-year historical consumption records
  const formattedHistoryData = useMemo(() => {
    const yearsMap: Record<number, any> = {};
    const years = Array.from(new Set(filteredHistoricalConsumption.map(r => r.year))).sort((a, b) => a - b);
    
    years.forEach(yr => {
      yearsMap[yr] = {
        year: yr.toString(),
        'Lanka Tiles': 0,
        'Lanka Wall Tiles': 0,
        'Rocell Horana': 0,
        'Rocell Eheliyagoda': 0
      };
    });

    filteredHistoricalConsumption.forEach(record => {
      const yr = record.year;
      if (yearsMap[yr]) {
        yearsMap[yr][record.factoryId] = record.consumptionValue;
      }
    });

    return Object.values(yearsMap);
  }, [filteredHistoricalConsumption]);

  const mechanicalValue = smParts.reduce((acc, p) => acc + (p.consumptionValue || 0), 0);
  const electricalValue = seParts.reduce((acc, p) => acc + (p.consumptionValue || 0), 0);

  const insightsDescription = totalConsValue > 0
    ? (selectedFactory === 'All'
      ? `Overall system logs record a cumulative consumption of ${totalConsQty.toLocaleString()} spare parts across all active factories, representing a total inventory issue value of Rs. ${totalConsValue.toLocaleString()}. Currently, ${highestConsPlant} reports the highest usage rate, accounting for Rs. ${plantConsumption.find(p => p.name === highestConsPlant)?.value.toLocaleString() || 0} of overall consumption. Spare consumption is categorized into mechanical and electrical components to monitor plant health.`
      : `For ${selectedFactory}, the logs record a total consumption of ${totalConsQty.toLocaleString()} spare parts, representing a total inventory issue value of Rs. ${totalConsValue.toLocaleString()}. Mechanical components account for Rs. ${mechanicalValue.toLocaleString()} and electrical components account for Rs. ${electricalValue.toLocaleString()}.`)
    : (selectedFactory === 'All'
      ? "No active spare parts consumption has been ingested. Please upload daily SAP/Oracle consumption files in the Manage Data view to visualize charts."
      : `No active spare parts consumption has been ingested for ${selectedFactory}. Please upload daily SAP/Oracle consumption files in the Manage Data view to visualize charts.`);

  const renderConsumptionTable = (list: SparePart[], title: string, badgeBg: string, badgeText: string) => {
    return (
      <div className="flex-1 bg-white/65 backdrop-blur-sm rounded-[2rem] border border-gray-200/50 p-6 shadow-sm flex flex-col h-[500px] overflow-hidden">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-black tracking-wider uppercase ${badgeBg} ${badgeText}`}>
              {title}
            </span>
            <span className="text-xs font-bold text-gray-400">{list.length} Items</span>
          </div>
          <span className="text-xs font-bold text-gray-500">
            Total Value: Rs. {list.reduce((acc, p) => acc + (p.consumptionValue || 0), 0).toLocaleString()}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
          {list.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
              <span className="text-xs font-bold">No active consumption recorded.</span>
              <p className="text-[10px] text-center max-w-[200px] text-gray-400 leading-normal font-medium">Upload a MB51 or Material Transaction report to ingest consumption data.</p>
            </div>
          ) : (
            list.map(p => (
              <div key={p.id} className="p-4 bg-white/80 rounded-2xl border border-gray-100 flex items-center justify-between hover:shadow-sm hover:border-gray-200 transition-all">
                <div className="space-y-1.5 max-w-[65%]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{p.materialNumber}</span>
                    <span className="text-[10px] font-bold text-gray-400 truncate">{p.factoryId}</span>
                  </div>
                  <h4 className="text-xs font-bold text-gray-800 line-clamp-1">{p.description}</h4>
                  <p className="text-[10px] text-gray-400 font-semibold truncate">Machine: {p.machine || '-'}</p>
                </div>

                <div className="text-right space-y-1 shrink-0">
                  <span className="inline-block text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                    Consumed: {p.consumptionQty}
                  </span>
                  <p className="text-xs font-black text-gray-700">Rs. {(p.consumptionValue || 0).toLocaleString()}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const chartColors = ['#3b82f6', '#10b981', '#f59e0b', '#7c3aed'];
  const typeColors = ['#7c3aed', '#6366f1'];
  
  const factoryColors: Record<string, string> = {
    'Lanka Tiles': '#3b82f6',
    'Lanka Wall Tiles': '#10b981',
    'Rocell Horana': '#f59e0b',
    'Rocell Eheliyagoda': '#7c3aed'
  };

  return (
    <div className="space-y-6">
      {/* Factory Selection Segmented Pills */}
      <div className="flex flex-wrap items-center gap-2 bg-white/60 backdrop-blur-md p-2 rounded-2xl border border-gray-200/50 shadow-sm shrink-0">
        <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider mr-2 ml-2">Plant Selector:</span>
        {(['All', 'Lanka Tiles', 'Lanka Wall Tiles', 'Rocell Horana', 'Rocell Eheliyagoda'] as const).map((factory) => {
          const isActive = selectedFactory === factory;
          return (
            <button
              key={factory}
              onClick={() => setSelectedFactory(factory)}
              className={`
                px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all duration-200 cursor-pointer
                ${isActive 
                  ? 'bg-blue-600 text-white shadow shadow-blue-100 scale-[1.02]' 
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/50'}
              `}
            >
              {factory === 'All' ? 'All Plants' : factory}
            </button>
          );
        })}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 3-Year Historical Consumption Bar Chart */}
        <div className="lg:col-span-2 bg-white/65 backdrop-blur-sm rounded-[2rem] border border-gray-200/50 p-6 shadow-sm flex flex-col h-[400px]">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">
                {selectedFactory === 'All' ? '3-Year Factory-wise Historical Consumption (Rs.)' : `3-Year Historical Consumption for ${selectedFactory} (Rs.)`}
              </h3>
              <p className="text-[10px] text-gray-400 mt-1 font-semibold">Annual spare parts issues aggregated by location</p>
            </div>
            <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">
              {selectedFactory === 'All' ? 'Multi-Factory Annual Trends' : 'Plant Annual Trend'}
            </span>
          </div>
          <div className="flex-1 min-h-0">
            {formattedHistoryData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-xs font-bold">No historical data available. Please upload a 3-Year history file.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={formattedHistoryData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <XAxis dataKey="year" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `Rs. ${(v / 1000000).toFixed(1)}M`} />
                  <Tooltip formatter={(value, name) => [`Rs. ${Number(value).toLocaleString()}`, name]} contentStyle={{ borderRadius: '1rem', border: '1px solid #f1f5f9' }} />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                  {selectedFactory === 'All' ? (
                    <>
                      <Bar dataKey="Lanka Tiles" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="Lanka Wall Tiles" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="Rocell Horana" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="Rocell Eheliyagoda" stackId="a" fill="#7c3aed" radius={[8, 8, 0, 0]} />
                    </>
                  ) : (
                    <Bar dataKey={selectedFactory} fill={factoryColors[selectedFactory] || '#3b82f6'} radius={[8, 8, 0, 0]} />
                  )}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bar Chart Card (Plant breakdown or Type breakdown) */}
        <div className="bg-white/65 backdrop-blur-sm rounded-[2rem] border border-gray-200/50 p-6 shadow-sm flex flex-col h-[350px]">
          <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 shrink-0">
            {selectedFactory === 'All' ? 'Consumption Value per Plant (Rs.)' : 'Spares Consumption Value by Type (Rs.)'}
          </h3>
          <div className="flex-1 min-h-0">
            {totalConsValue === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-xs font-bold">No charts available. Ingest daily reports first.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={selectedFactory === 'All' ? plantConsumption : spareTypeConsumption}>
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `Rs. ${v.toLocaleString()}`} />
                  <Tooltip formatter={(value) => [`Rs. ${value.toLocaleString()}`, 'Value']} contentStyle={{ borderRadius: '1rem', border: '1px solid #f1f5f9' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {(selectedFactory === 'All' ? plantConsumption : spareTypeConsumption).map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={selectedFactory === 'All' ? chartColors[index % chartColors.length] : typeColors[index % typeColors.length]} 
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Pie Chart Card (Plant breakdown % or Type breakdown %) */}
        <div className="bg-white/65 backdrop-blur-sm rounded-[2rem] border border-gray-200/50 p-6 shadow-sm flex flex-col h-[350px]">
          <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 shrink-0">Consumption Distribution %</h3>
          <div className="flex-1 min-h-0 flex items-center justify-center">
            {totalConsValue === 0 ? (
              <div className="text-gray-400 text-xs font-bold">No charts available. Ingest daily reports first.</div>
            ) : (
              <div className="w-full h-full flex flex-col sm:flex-row items-center justify-center gap-4">
                <div className="w-1/2 h-full min-h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={selectedFactory === 'All' ? plantConsumption : spareTypeConsumption}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {(selectedFactory === 'All' ? plantConsumption : spareTypeConsumption).map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={selectedFactory === 'All' ? chartColors[index % chartColors.length] : typeColors[index % typeColors.length]} 
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`Rs. ${value.toLocaleString()}`, 'Value']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-2 font-semibold text-xs shrink-0 max-w-[50%]">
                  {(selectedFactory === 'All' ? plantConsumption : spareTypeConsumption).map((entry, index) => {
                    const percentage = totalConsValue > 0 ? (entry.value / totalConsValue) * 100 : 0;
                    return (
                      <div key={entry.name} className="flex items-center gap-2">
                        <span 
                          className="w-3 h-3 rounded-full shrink-0" 
                          style={{ backgroundColor: selectedFactory === 'All' ? chartColors[index % chartColors.length] : typeColors[index % typeColors.length] }}
                        ></span>
                        <span className="text-gray-500 truncate">{entry.name}:</span>
                        <span className="text-gray-900 font-bold shrink-0">{percentage.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description Insights Card */}
      <div className="bg-white/65 backdrop-blur-sm rounded-[2rem] border border-gray-200/50 p-6 shadow-sm flex items-start gap-4">
        <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl shrink-0 mt-0.5">
          <Sparkles className="w-5 h-5 text-blue-600 animate-pulse" />
        </div>
        <div>
          <h4 className="text-xs font-black uppercase tracking-wider text-blue-600">Consumption Insights</h4>
          <p className="text-xs text-gray-600 mt-2 font-medium leading-relaxed">{insightsDescription}</p>
        </div>
      </div>

      {/* Dual Table Section */}
      <div className="flex flex-col md:flex-row gap-6">
        {renderConsumptionTable(smParts, 'SM - Mechanical Spares', 'bg-purple-50 text-purple-700 border border-purple-100', 'text-purple-700')}
        {renderConsumptionTable(seParts, 'SE - Electrical Spares', 'bg-indigo-50 text-indigo-700 border border-indigo-100', 'text-indigo-700')}
      </div>
    </div>
  );
};

const DashboardGuide: React.FC = () => {
  return (
    <div className="bg-white/80 backdrop-blur-md rounded-[2rem] border border-gray-200/50 p-8 shadow-sm space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-lg font-black text-gray-900 tracking-tight">Cross-Plant Ordering Guide</h3>
          <p className="text-xs text-gray-500 mt-1 font-semibold">Instantly learn how to find and request spare parts across our manufacturing network.</p>
        </div>
        <span className="self-start sm:self-auto text-[10px] font-black uppercase text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1 rounded-full tracking-wider">
          How-To Guide
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative">
        {/* Step 1 */}
        <div className="relative group bg-white/50 backdrop-blur-sm p-6 rounded-2xl border border-gray-100/80 hover:shadow-lg hover:border-blue-100 hover:bg-white hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold text-lg group-hover:scale-110 transition-transform duration-300">
              <LogIn className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h4 className="text-sm font-bold text-gray-900">1. Authenticate & Log In</h4>
              <p className="text-xs text-gray-500 font-semibold leading-relaxed">
                Log into the portal using your factory credentials. Administrators see inventory controls, and users can place peer-to-peer orders.
              </p>
            </div>
          </div>
          <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 text-gray-300 animate-pulse">
            <ArrowRight className="w-6 h-6" />
          </div>
        </div>

        {/* Step 2 */}
        <div className="relative group bg-white/50 backdrop-blur-sm p-6 rounded-2xl border border-gray-100/80 hover:shadow-lg hover:border-blue-100 hover:bg-white hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center font-bold text-lg group-hover:scale-110 transition-transform duration-300">
              <Search className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h4 className="text-sm font-bold text-gray-900">2. Search the Catalogue</h4>
              <p className="text-xs text-gray-500 font-semibold leading-relaxed">
                Use the search input on the dashboard to search for parts by description, material number, part code, or machine association.
              </p>
            </div>
          </div>
          <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 text-gray-300 animate-pulse">
            <ArrowRight className="w-6 h-6" />
          </div>
        </div>

        {/* Step 3 */}
        <div className="relative group bg-white/50 backdrop-blur-sm p-6 rounded-2xl border border-gray-100/80 hover:shadow-lg hover:border-blue-100 hover:bg-white hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center font-bold text-lg group-hover:scale-110 transition-transform duration-300">
              <Globe className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h4 className="text-sm font-bold text-gray-900">3. Check Plant Locations</h4>
              <p className="text-xs text-gray-500 font-semibold leading-relaxed">
                Scan search results to see which plant holds the stock. The colored badge (e.g. Lanka Wall Tiles, Rocell Horana) shows ownership.
              </p>
            </div>
          </div>
          <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 text-gray-300 animate-pulse">
            <ArrowRight className="w-6 h-6" />
          </div>
        </div>

        {/* Step 4 */}
        <div className="relative group bg-white/50 backdrop-blur-sm p-6 rounded-2xl border border-gray-100/80 hover:shadow-lg hover:border-blue-100 hover:bg-white hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center font-bold text-lg group-hover:scale-110 transition-transform duration-300">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h4 className="text-sm font-bold text-gray-900">4. Request Transfer</h4>
              <p className="text-xs text-gray-500 font-semibold leading-relaxed">
                Add the required item to your Cart, adjust quantities, and click Request. The source plant will receive an alert to approve and ship it!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [parts, setParts] = useState<SparePart[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'inventory' | 'orders' | 'users' | 'audit'>('dashboard');
  const [processingFactory, setProcessingFactory] = useState<string | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [loadingDB, setLoadingDB] = useState(false);
  
  // Upload Preview State
  const [uploadPreview, setUploadPreview] = useState<ExcelParseResult | null>(null);
  const [isConfirmingUpload, setIsConfirmingUpload] = useState(false);

  // Cart State
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const [notificationCounts, setNotificationCounts] = useState({ orders: 0, users: 0 });

  // Theme State
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  // Sync theme with body class and local storage
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark-mode');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.remove('dark-mode');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  // Dashboard Sub-tabs
  const [dashboardSubTab, setDashboardSubTab] = useState<'overview' | 'consumption'>('overview');

  // System Reports (SAP / Oracle) States
  const [manageDataTab, setManageDataTab] = useState<'excel' | 'system' | 'history' | 'upload_history'>('excel');
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryRecord[]>([]);
  const [isRevertingUpload, setIsRevertingUpload] = useState<string | null>(null);
  const [historicalConsumption, setHistoricalConsumption] = useState<HistoricalConsumptionRecord[]>([]);
  const [selectedHistoryFactory, setSelectedHistoryFactory] = useState<string>('All');
  const [isProcessingHistory, setIsProcessingHistory] = useState(false);
  const [historyFeedback, setHistoryFeedback] = useState<string | null>(null);
  const [selectedReportFactory, setSelectedReportFactory] = useState('Lanka Tiles');
  const [selectedSystem, setSelectedSystem] = useState<'SAP' | 'Oracle'>('SAP');
  const [selectedReportType, setSelectedReportType] = useState('MB52');
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [isProcessingReport, setIsProcessingReport] = useState(false);

  const handleSystemReportUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setIsProcessingReport(true);
    setReportFeedback(null);
    const file = e.target.files[0];
    
    try {
      // 1. Parse report
      const result = await parseSystemReport(file, selectedReportFactory, selectedSystem, selectedReportType);
      
      // 2. Commit updates to database
      const { updatedCount, deductedCount } = await saveSystemReport(
        selectedReportFactory,
        result.reportType,
        result.updatedParts,
        currentUser?.username || 'unknown'
      );
      
      // 3. Refresh display catalog data
      await refreshData();
      
      // 4. Update UI feedback
      if (result.reportType.includes('MB51') || result.reportType.includes('TRANSACTION')) {
        setReportFeedback(`Successfully processed daily consumption report: ${file.name}. Checked ${result.metadata.totalRows} lines, matching and deducting stock values for ${deductedCount} active spare parts.`);
      } else {
        setReportFeedback(`Successfully processed stock inventory report: ${file.name}. Created or updated stock quantities for ${updatedCount} items at ${selectedReportFactory}.`);
      }
      
      // Reset input element value
      e.target.value = '';
    } catch (err) {
      console.error("System report processing failed", err);
      alert(`Report processing failed: ${(err as any).message || String(err)}`);
    } finally {
      setIsProcessingReport(false);
    }
  };

  const handleHistoricalConsumptionUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setIsProcessingHistory(true);
    setHistoryFeedback(null);
    const file = e.target.files[0];
    
    try {
      if (apiSource === 'backend') {
        // Upload to Live Express Backend
        const result = await uploadHistoricalConsumptionFile(file, currentUser?.username || 'unknown', selectedHistoryFactory);
        if (result.success) {
          setHistoryFeedback(result.message);
          await refreshData();
        } else {
          throw new Error(result.message);
        }
      } else {
        // Fallback Mode: Parse client-side using XLSX
        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const data = evt.target?.result;
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rawRows = XLSX.utils.sheet_to_json(worksheet) as any[];

            if (rawRows.length === 0) {
              throw new Error("The uploaded file contains no data.");
            }

            // Factory resolver helper
            const resolveFactory = (rawName: string) => {
              if (!rawName) return null;
              const name = rawName.trim().toLowerCase();
              if (name.includes('lanka') && name.includes('wall')) return 'Lanka Wall Tiles';
              if (name.includes('lanka') && name.includes('tile')) return 'Lanka Tiles';
              if (name.includes('horana')) return 'Rocell Horana';
              if (name.includes('eheliyagoda')) return 'Rocell Eheliyagoda';
              return null;
            };

            const recordsMap: Record<string, HistoricalConsumptionRecord> = {};
            let validCount = 0;
            const errors: string[] = [];

            rawRows.forEach((row, index) => {
              const getVal = (keys: string[]) => {
                for (const k of keys) {
                  if (row[k] !== undefined) return row[k];
                  const foundKey = Object.keys(row).find(rk => rk.toLowerCase().trim() === k.toLowerCase().trim());
                  if (foundKey) return row[foundKey];
                }
                return null;
              };

              const rawFactory = getVal(['Factory', 'Factory Name', 'Plant', 'FactoryId', 'Location']);
              const rawYear = getVal(['Year', 'Date', 'Calendar Year']);
              const rawQty = getVal(['Consumption Qty', 'Quantity', 'Qty', 'Consumption Quantity', 'Qty Consumed']);
              const rawValue = getVal(['Consumption Value', 'Value', 'Cost', 'Consumption Value (Rs.)', 'Amount']);

              const factoryId = selectedHistoryFactory !== 'All' ? selectedHistoryFactory : resolveFactory(String(rawFactory));
              const year = parseInt(String(rawYear), 10);
              const qty = parseFloat(String(rawQty));
              const value = parseFloat(String(rawValue));

              if (!factoryId || isNaN(year) || year < 2000 || year > 2030 || isNaN(qty) || qty < 0 || isNaN(value) || value < 0) {
                errors.push(`Row ${index + 2}: Parsing error or invalid data.`);
                return;
              }

              const key = `${factoryId}-${year}`;
              if (!recordsMap[key]) {
                recordsMap[key] = {
                  id: key.replace(/\s+/g, '_'),
                  factoryId,
                  year,
                  consumptionQty: 0,
                  consumptionValue: 0,
                  uploadedBy: currentUser?.username || 'unknown',
                  timestamp: Date.now()
                };
              }
              recordsMap[key].consumptionQty += qty;
              recordsMap[key].consumptionValue += value;
              validCount++;
            });

            const parsedRecords = Object.values(recordsMap);
            if (parsedRecords.length === 0) {
              throw new Error("No valid records could be extracted from the file.");
            }

            // Save to Firestore directly
            await saveHistoricalConsumption(parsedRecords, currentUser?.username || 'unknown');
            
            // Refresh
            await refreshData();

            setHistoryFeedback(`Successfully processed and validated ${validCount} entries. Created ${parsedRecords.length} factory-wise annual consumption summaries in database.`);
          } catch (err: any) {
            console.error(err);
            alert(`File parsing failed: ${err.message || String(err)}`);
          } finally {
            setIsProcessingHistory(false);
          }
        };
        reader.readAsArrayBuffer(file);
      }
      
      // Reset input element
      e.target.value = '';
    } catch (err: any) {
      console.error("History upload failed", err);
      alert(`History upload failed: ${err.message || String(err)}`);
      setIsProcessingHistory(false);
    }
  };

  const handleExportConsumptionExcel = () => {
    const consumedParts = parts.filter(p => (p.consumptionQty || 0) > 0);
    
    const smParts = consumedParts.filter(p => {
      const type = (p.spareType || '').trim().toUpperCase();
      return type === 'SM' || type.includes('MECHANICAL') || type === 'M' || type.includes('MECH');
    });
    
    const seParts = consumedParts.filter(p => {
      const type = (p.spareType || '').trim().toUpperCase();
      return type === 'SE' || type.includes('ELECTRICAL') || type === 'E' || type.includes('ELEC');
    });

    // 1. Calculate overall summary data per plant for Excel report
    const summaryMap = new Map<string, { quantity: number; value: number }>();
    const factoriesList = ['Lanka Tiles', 'Lanka Wall Tiles', 'Rocell Horana', 'Rocell Eheliyagoda'];
    factoriesList.forEach(f => summaryMap.set(f, { quantity: 0, value: 0 }));

    consumedParts.forEach(p => {
      if (!summaryMap.has(p.factoryId)) {
        summaryMap.set(p.factoryId, { quantity: 0, value: 0 });
      }
      const entry = summaryMap.get(p.factoryId)!;
      entry.quantity += p.consumptionQty || 0;
      entry.value += p.consumptionValue || 0;
    });

    const summaryData = Array.from(summaryMap.entries()).map(([name, data]) => ({
      'Factory Name': name,
      'Total Quantity Consumed': data.quantity,
      'Total Consumption Value (Rs.)': data.value
    }));

    let totalQ = 0;
    let totalV = 0;
    let maxV = -1;
    let maxPlant = 'None';
    summaryData.forEach(d => {
      totalQ += d['Total Quantity Consumed'];
      totalV += d['Total Consumption Value (Rs.)'];
      if (d['Total Consumption Value (Rs.)'] > maxV) {
        maxV = d['Total Consumption Value (Rs.)'];
        maxPlant = d['Factory Name'];
      }
    });

    const insightsText = totalV > 0
      ? `Overall system logs record a cumulative consumption of ${totalQ.toLocaleString()} spare parts across all active factories, representing a total inventory issue value of Rs. ${totalV.toLocaleString()}. Currently, ${maxPlant} reports the highest usage rate, accounting for Rs. ${maxV.toLocaleString()} of overall consumption.`
      : "No active spare parts consumption has been ingested.";

    const wb = XLSX.utils.book_new();

    // 2. Convert summaries, description, and lists to sheets
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    
    // Add descriptive analysis text at the bottom of the Summary sheet
    XLSX.utils.sheet_add_aoa(wsSummary, [
      [],
      ['Description Analysis:'],
      [insightsText]
    ], { origin: -1 });

    const smData = smParts.map(p => ({
      'Factory': p.factoryId,
      'Material Number': p.materialNumber,
      'Part Number': p.partNumber,
      'Description': p.description,
      'Machine': p.machine,
      'Quantity Consumed': p.consumptionQty || 0,
      'Unit Cost (Rs.)': p.unitCost,
      'Consumption Value (Rs.)': p.consumptionValue || 0
    }));

    const seData = seParts.map(p => ({
      'Factory': p.factoryId,
      'Material Number': p.materialNumber,
      'Part Number': p.partNumber,
      'Description': p.description,
      'Machine': p.machine,
      'Quantity Consumed': p.consumptionQty || 0,
      'Unit Cost (Rs.)': p.unitCost,
      'Consumption Value (Rs.)': p.consumptionValue || 0
    }));

    const wsSM = XLSX.utils.json_to_sheet(smData);
    const wsSE = XLSX.utils.json_to_sheet(seData);

    // Append sheets in order
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Overall Summary');
    XLSX.utils.book_append_sheet(wb, wsSM, 'SM - Mechanical');
    XLSX.utils.book_append_sheet(wb, wsSE, 'SE - Electrical');

    XLSX.writeFile(wb, `Daily_Consumption_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // API integration states
  const [duplicatesRemoved, setDuplicatesRemoved] = useState(0);
  const [apiSource, setApiSource] = useState<'backend' | 'fallback'>('fallback');
  const [factories, setFactories] = useState(FACTORIES);

  // Load data from DB on Login
  useEffect(() => {
    if (currentUser) {
      refreshData();
      fetchNotifications();

      // Poll for notifications every 30 seconds
      const interval = setInterval(fetchNotifications, 30000);
      return () => clearInterval(interval);
    }
  }, [currentUser]);

  const refreshData = async () => {
    setLoadingDB(true);
    try {
      // 1. Fetch local Firestore parts
      const localData = await getInventory();

      // 2. Fetch backend parts
      const { parts: backendData, source: partsSource } = await fetchBackendParts();

      // 3. Merge and deduplicate
      const { parts: mergedParts, removedDuplicatesCount } = mergeAndDeduplicate(localData, backendData);

      // Dynamically attach image URLs if missing or old Google Drive formats
      const enrichedParts = mergedParts.map(part => {
        let imageUrl = part.imageUrl;
        let image_url = part.image_url;

        // Normalize if exists
        if (imageUrl) imageUrl = normalizeImageUrl(imageUrl);
        if (image_url) image_url = normalizeImageUrl(image_url);

        // Fallback lookup if empty or NONE
        if (!imageUrl || imageUrl === 'NONE') {
          const mappedUrl = materialImages[part.materialNumber as keyof typeof materialImages];
          if (mappedUrl) {
            imageUrl = mappedUrl;
            image_url = mappedUrl;
          }
        }

        return {
          ...part,
          imageUrl,
          image_url
        };
      });

      setParts(enrichedParts);
      setDuplicatesRemoved(removedDuplicatesCount);
      setApiSource(partsSource);

      // 4. Fetch backend factories dynamically
      const { factories: backendFactories } = await fetchBackendFactories();
      
      const FACTORY_THEMES = [
        { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: 'text-blue-600', hover: 'hover:border-blue-400' },
        { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: 'text-emerald-600', hover: 'hover:border-emerald-400' },
        { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: 'text-amber-600', hover: 'hover:border-amber-400' },
        { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', icon: 'text-purple-600', hover: 'hover:border-purple-400' },
        { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', icon: 'text-rose-600', hover: 'hover:border-rose-400' },
        { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', icon: 'text-indigo-600', hover: 'hover:border-indigo-400' }
      ];

      const updatedFactories = [...FACTORIES];
      backendFactories.forEach(bf => {
        if (!updatedFactories.some(f => f.id === bf.id || f.name === bf.name)) {
          const theme = FACTORY_THEMES[updatedFactories.length % FACTORY_THEMES.length];
          updatedFactories.push({
            id: bf.id,
            name: bf.name,
            theme
          });
        }
      });
      setFactories(updatedFactories);

      // 5. Fetch historical consumption
      const { records: histRecords } = await fetchHistoricalConsumption();
      setHistoricalConsumption(histRecords);

      // 6. Fetch upload history
      const historyLogs = await getUploadHistory();
      setUploadHistory(historyLogs);
    } catch (error) {
      console.error("Error refreshing unified data sources:", error);
    } finally {
      setLoadingDB(false);
    }
  };

  const fetchNotifications = async () => {
    if (!currentUser) return;
    try {
      // 1. Orders
      const allOrders = await getOrders(currentUser);
      const pendingOrders = allOrders.filter(o =>
        o.status === 'pending' &&
        (currentUser.role === 'admin' || (o.items.length > 0 && o.items[0].fromFactory === currentUser.factoryAffiliation))
      ).length;

      // 2. Users (Admin Only)
      let pendingUsers = 0;
      if (currentUser.role === 'admin') {
        const users = await getPendingUsers();
        pendingUsers = users.length;
      }

      setNotificationCounts({ orders: pendingOrders, users: pendingUsers });
    } catch (error) {
      console.error("Failed to fetch notifications", error);
    }
  };

  // --- Cart Actions ---
  const handleAddToCart = (part: SparePart) => {
    setCartItems(prev => {
      const existing = prev.find(item => item.id === part.id);
      if (existing) {
        // If already exists, increment qty if stock allows
        if (existing.orderQty < existing.onHand) {
          return prev.map(item => item.id === part.id ? { ...item, orderQty: item.orderQty + 1 } : item);
        }
        return prev;
      }
      return [...prev, { ...part, orderQty: 1 }];
    });
    setIsCartOpen(true);
  };

  const handleUpdateCartQty = (id: string, qty: number) => {
    setCartItems(prev => prev.map(item => item.id === id ? { ...item, orderQty: qty } : item));
  };

  const handleRemoveFromCart = (id: string) => {
    setCartItems(prev => prev.filter(item => item.id !== id));
  };

  const handleClearCart = () => {
    setCartItems([]);
  };

  // Track which factories have data uploaded
  const uploadedFactories = useMemo(() => {
    return new Set(parts.map(p => p.factoryId));
  }, [parts]);

  const handleFactoryUpload = (factoryName: string) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setProcessingFactory(factoryName);
      try {
        const file = e.target.files[0];
        const result = await parseExcelFile(file, factoryName);
        setUploadPreview(result);
      } catch (error) {
        console.error("Error parsing or saving file", error);
        alert("Error parsing Excel file. Please check the format.");
        setProcessingFactory(null);
      }
    }
  };

  const confirmUpload = async () => {
    if (!uploadPreview) return;
    
    setIsConfirmingUpload(true);
    try {
      await saveInventory(uploadPreview.parts, currentUser?.username || 'unknown');
      await refreshData();
      
      // Success Cleanup
      setUploadPreview(null);
      setProcessingFactory(null);
      if (showUploadModal) setShowUploadModal(false);
      
      alert(`Successfully uploaded ${uploadPreview.parts.length} items to ${uploadPreview.metadata.factoryId}`);
    } catch (error) {
      console.error("Upload failed", error);
      const errorMsg = (error as any).message || String(error);
      if (errorMsg.toLowerCase().includes('permission')) {
        alert(`Permission Error: The database denied the request. 
        
This usually means the Firestore Security Rules on the server are NOT updated. 

Please ensure you have deployed 'firestore.rules' or manually updated them in the Firebase Console.
(Technical Details: ${errorMsg})`);
      } else {
        alert(`Failed to save items to database. 
        
Ensure the Excel format is correct and you have a stable internet connection.
(Error: ${errorMsg})`);
      }
    } finally {
      setIsConfirmingUpload(false);
    }
  };

  // Filter State
  const [factoryFilter, setFactoryFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [criticalityFilter, setCriticalityFilter] = useState<string>('');
  const [imageFilter, setImageFilter] = useState<string>('all');

  const filteredParts = useMemo(() => {
    let result = parts;

    // Apply Facilitated Filters
    if (factoryFilter) result = result.filter(p => p.factoryId === factoryFilter);
    if (categoryFilter) result = result.filter(p => p.categoryName === categoryFilter);
    if (criticalityFilter) {
      result = result.filter(p => {
        const raw = (p.criticality || '').trim().toLowerCase();
        const rawDesc = (p.description || '').trim().toLowerCase();
        if (criticalityFilter === 'Non Using') return raw.includes('non') || raw.includes('unused') || rawDesc.includes('non using');
        if (criticalityFilter === 'Vital') return raw.includes('vita');
        if (criticalityFilter === 'Essential') return raw.includes('essen');
        if (criticalityFilter === 'Desirable') return raw.includes('desir') || raw.includes('norm');
        return true;
      });
    }

    if (imageFilter !== 'all') {
      result = result.filter(p => {
        const hasImg = !!(p.imageUrl || p.image_url) && p.imageUrl !== 'NONE' && p.image_url !== 'NONE';
        return imageFilter === 'with' ? hasImg : !hasImg;
      });
    }

    if (!searchQuery.trim()) return result;
    const terms = searchQuery.toLowerCase().trim().split(/\s+/);

    return result
      .map(part => {
        let score = 0;
        const searchPool = [
          { val: part.materialNumber?.toLowerCase(), weight: 10 },
          { val: part.partNumber?.toLowerCase(), weight: 8 },
          { val: part.description?.toLowerCase(), weight: 5 },
          { val: part.machine?.toLowerCase(), weight: 3 },
          { val: part.categoryName?.toLowerCase(), weight: 2 },
          { val: part.factoryId?.toLowerCase(), weight: 1 },
        ];

        terms.forEach(term => {
          searchPool.forEach(({ val, weight }) => {
            if (!val) return;
            if (val === term) score += weight * 5; // Perfect match
            else if (val.startsWith(term)) score += weight * 3; // Prefix match
            else if (val.includes(term)) score += weight * 1; // Substring match
          });
        });

        return { part, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.part);
  }, [parts, searchQuery, factoryFilter, categoryFilter, criticalityFilter, imageFilter]);

  const handleExportCSV = () => {
    if (filteredParts.length === 0) return;
    
    const headers = ['Material Number', 'Description', 'Factory', 'Category', 'Criticality', 'On Hand', 'Price', 'Total Value'];
    const rows = filteredParts.map(p => [
      `"${p.materialNumber}"`,
      `"${p.description}"`,
      `"${p.factoryId}"`,
      `"${p.categoryName}"`,
      `"${p.criticality}"`,
      p.onHand,
      p.unitCost,
      p.totalValue
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `spare_parts_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Auth Guard
  if (!currentUser) {
    return <Login onLogin={setCurrentUser} />;
  }

  const FactoryCard: React.FC<{ factory: any }> = ({ factory }) => {
    const isUploaded = uploadedFactories.has(factory.name);
    const isProcessing = processingFactory === factory.name;

    return (
      <div className={`
        relative rounded-xl border-2 transition-all duration-200 overflow-hidden flex flex-col
        ${isUploaded ? 'bg-white border-gray-200' : `${factory.theme.bg} ${factory.theme.border} ${factory.theme.hover}`}
        ${isProcessing ? 'opacity-70 pointer-events-none' : ''}
      `}>
        <div className="p-6 flex flex-col items-center text-center flex-1 gap-4">
          {/* Icon Status */}
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isUploaded ? 'bg-green-100' : 'bg-white shadow-sm'}`}>
            {isProcessing ? (
              <RefreshCw className={`w-6 h-6 animate-spin ${factory.theme.text}`} />
            ) : isUploaded ? (
              <CheckCircle className="w-6 h-6 text-green-600" />
            ) : (
              <FileSpreadsheet className={`w-6 h-6 ${factory.theme.icon}`} />
            )}
          </div>

          <h3 className={`font-bold text-lg ${isUploaded ? 'text-gray-900' : factory.theme.text}`}>
            {factory.name}
          </h3>

          {/* Stats if uploaded */}
          {isUploaded ? (
            <p className="text-xs text-gray-500">
              {parts.filter(p => p.factoryId === factory.name).length} items loaded
            </p>
          ) : (
            <p className="text-xs opacity-70">Upload inventory excel file</p>
          )}
        </div>

        {/* Action Button - Only Admin can upload/delete */}
        {currentUser.role === 'admin' && (
          <div className="flex border-t border-gray-100">
            <label className={`
                flex-1 py-3 text-sm font-medium text-center cursor-pointer transition-colors
                ${isUploaded
                ? 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                : 'bg-white/50 hover:bg-white text-gray-700 hover:bg-gray-50'}
            `}>
              {isProcessing ? 'Processing... ' : isUploaded ? 'Replace Data' : 'Upload Data'}
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={handleFactoryUpload(factory.name)}
                className="hidden"
                disabled={isProcessing}
              />
            </label>
            {isUploaded && (
              <button
                onClick={async () => {
                  if (confirm(`Are you sure you want to delete ALL data for ${factory.name}? This action cannot be undone.`)) {
                    setProcessingFactory(factory.name);
                    try {
                      await deleteFactoryData(factory.name, currentUser.username);
                      await refreshData();
                    } catch (error) {
                      console.error("Error deleting factory data:", error);
                      alert("Failed to delete data. Please try again.");
                    } finally {
                      setProcessingFactory(null);
                    }
                  }
                }}
                className="w-12 flex items-center justify-center border-l border-gray-200 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                title="Delete Factory Data"
                disabled={isProcessing}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar Navigation */}
      <aside className={`h-screen sticky top-0 flex flex-col justify-between border-r border-gray-200 bg-white z-30 transition-all duration-300 shrink-0 ${isSidebarCollapsed ? 'w-20' : 'w-64'}`}>
        {/* Top part: Hamburger toggle and Logo */}
        <div className="p-4 flex flex-col gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
              title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              <Menu className="w-5 h-5" />
            </button>
            {!isSidebarCollapsed && (
              <div className="flex items-center gap-3 animate-in fade-in duration-200">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center text-white font-bold shadow-md shadow-blue-200">
                  <span className="text-base">S</span>
                </div>
                <div>
                  <h1 className="text-sm font-bold text-gray-900 leading-none">SpareShare</h1>
                  <p className="text-[9px] uppercase tracking-wider text-gray-400 font-bold mt-0.5">
                    {currentUser.role === 'admin' ? 'Admin Portal' : 'User Portal'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Middle part: Navigation Menu Links */}
        <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto min-h-0">
          {(['dashboard', 'inventory', 'orders', 'users', 'audit'] as const).map((tab) => {
            if ((tab === 'users' || tab === 'audit') && currentUser.role !== 'admin') return null;
            
            const isActive = activeTab === tab;
            const icons = {
              dashboard: LayoutDashboard,
              inventory: SlidersHorizontal,
              orders: ShoppingBag,
              users: Users,
              audit: ShieldAlert
            };
            const Icon = icons[tab];
            const count = tab === 'orders' ? notificationCounts.orders : (tab === 'users' ? notificationCounts.users : 0);

            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`
                  w-full flex items-center gap-3 px-3 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all duration-200 cursor-pointer relative group
                  ${isActive 
                    ? 'bg-white shadow border-l-4 border-blue-600 pl-2 text-blue-600 font-black' 
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}
                `}
                title={isSidebarCollapsed ? tab : undefined}
              >
                <div className="relative flex items-center justify-center shrink-0 w-5 h-5">
                  <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600 font-black' : 'text-gray-400 group-hover:text-gray-600'}`} />
                  {isSidebarCollapsed && count > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] text-white font-bold border border-white shadow-sm">
                      {count > 9 ? '9+' : count}
                    </span>
                  )}
                </div>
                
                {!isSidebarCollapsed && (
                  <span className="truncate animate-in fade-in duration-200">{tab}</span>
                )}
                
                {!isSidebarCollapsed && count > 0 && (
                  <span className="ml-auto flex h-5 px-1.5 min-w-[20px] items-center justify-center rounded-full bg-red-500 text-[10px] text-white font-bold border border-white shadow-sm">
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </button>
            );
          })}

          {/* AI Assistant Sidebar Trigger */}
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className={`
              w-full flex items-center gap-3 px-3 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all duration-200 cursor-pointer relative group
              ${isChatOpen 
                ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600 pl-2 text-blue-600 font-black' 
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}
            `}
            title={isSidebarCollapsed ? "AI Assistant" : undefined}
          >
            <div className="relative flex items-center justify-center shrink-0 w-5 h-5">
              <Sparkles className={`w-5 h-5 ${isChatOpen ? 'text-blue-600 font-black animate-pulse' : 'text-gray-400 group-hover:text-gray-600'}`} />
            </div>
            {!isSidebarCollapsed && (
              <span className="truncate animate-in fade-in duration-200">AI Assistant</span>
            )}
            {!isSidebarCollapsed && (
              <span className="ml-auto text-[9px] font-black uppercase bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-md scale-90">
                AI
              </span>
            )}
          </button>
        </div>

        {/* Bottom part: User Profile, Theme, Cart, and Logout */}
        <div className="p-3 border-t border-gray-100 space-y-1.5 shrink-0">
          {/* Cart Button (Users only) */}
          {currentUser.role === 'user' && (
            <button
              onClick={() => setIsCartOpen(true)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all duration-200 cursor-pointer relative
              `}
              title={isSidebarCollapsed ? "View Cart" : undefined}
            >
              <div className="relative flex items-center justify-center shrink-0 w-5 h-5">
                <ShoppingCart className="w-5 h-5 text-gray-400 group-hover:text-blue-600" />
                {cartItems.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-white"></span>
                )}
              </div>
              {!isSidebarCollapsed && <span className="animate-in fade-in duration-200">View Cart</span>}
            </button>
          )}

          {/* Theme Toggle Button */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all duration-200 cursor-pointer"
            title={isSidebarCollapsed ? (darkMode ? "Switch to Light Mode" : "Switch to Dark Mode") : undefined}
          >
            <div className="flex items-center justify-center shrink-0 w-5 h-5">
              {darkMode ? <Sun className="w-5 h-5 text-yellow-500" /> : <Moon className="w-5 h-5 text-gray-400" />}
            </div>
            {!isSidebarCollapsed && (
              <span className="truncate animate-in fade-in duration-200">
                {darkMode ? 'Light Mode' : 'Dark Mode'}
              </span>
            )}
          </button>

          {/* Profile summary */}
          <div className={`flex items-center gap-3 px-3 py-2 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm shrink-0 uppercase">
              {currentUser.username.substring(0, 2)}
            </div>
            {!isSidebarCollapsed && (
              <div className="text-left min-w-0 flex-1 animate-in fade-in duration-200">
                <p className="text-xs font-bold text-gray-900 truncate leading-tight">{currentUser.username}</p>
                <p className="text-[10px] text-gray-400 font-semibold truncate leading-none mt-0.5 capitalize">{currentUser.role}</p>
              </div>
            )}
          </div>

          {/* Logout Button */}
          <button
            onClick={() => setCurrentUser(null)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all duration-200 cursor-pointer"
            title={isSidebarCollapsed ? "Logout" : undefined}
          >
            <div className="flex items-center justify-center shrink-0 w-5 h-5">
              <LogOut className="w-5 h-5 text-gray-400" />
            </div>
            {!isSidebarCollapsed && (
              <span className="truncate animate-in fade-in duration-200">Logout</span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        {/* Connection status and deduplication tracker */}
        <div className="bg-white/80 backdrop-blur-md p-5 rounded-3xl border border-gray-200/50 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              apiSource === 'backend' ? 'bg-green-50 text-green-600 shadow-sm shadow-green-100' : 'bg-amber-50 text-amber-600 shadow-sm shadow-amber-100'
            }`}>
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 leading-tight">Unified Portal Connection</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${apiSource === 'backend' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`}></span>
                <span className="text-xs text-gray-500 font-medium">
                  {apiSource === 'backend' 
                    ? 'Connected to Live Server: http://localhost:3000' 
                    : 'Backend server offline: Using high-quality mock data'}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end">
            <div className="text-left md:text-right">
              <p className="text-[10px] uppercase tracking-widest text-gray-400 font-extrabold">Data Source Status</p>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider mt-1 ${
                apiSource === 'backend' 
                  ? 'bg-green-50 text-green-700 border border-green-100' 
                  : 'bg-amber-50 text-amber-700 border border-amber-100'
              }`}>
                {apiSource === 'backend' ? 'Live API' : 'Fallback Mode'}
              </span>
            </div>
            
            <div className="h-8 w-[1px] bg-gray-200"></div>
            
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest text-gray-400 font-extrabold">Deduplication Agent</p>
              <div className="flex items-center justify-end gap-1.5 mt-1">
                <Sparkles className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
                <span className="text-xs font-black text-blue-600">
                  {duplicatesRemoved} duplicates stripped
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* State: No Data or Explicit Upload Mode (Only Admin can see upload modal) */}
        {(parts.length === 0 || showUploadModal) && currentUser.role === 'admin' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Manage Factory Data</h2>
                <p className="text-gray-500 text-sm mt-1">Upload parts inventories or ingest daily system reports.</p>
              </div>
              {parts.length > 0 && (
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    setReportFeedback(null);
                  }}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Return to Dashboard
                </button>
              )}
            </div>

            {/* Inner Sub-Tabs Segmented Control */}
            <div className="flex p-1 bg-gray-100/60 rounded-xl border border-gray-200/50 max-w-2xl">
              <button
                onClick={() => { setManageDataTab('excel'); setReportFeedback(null); setHistoryFeedback(null); }}
                className={`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                  manageDataTab === 'excel' ? 'bg-white text-blue-600 shadow' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Excel Templates
              </button>
              <button
                onClick={() => { setManageDataTab('system'); setReportFeedback(null); setHistoryFeedback(null); }}
                className={`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                  manageDataTab === 'system' ? 'bg-white text-blue-600 shadow' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                System Reports
              </button>
              <button
                onClick={() => { setManageDataTab('history'); setReportFeedback(null); setHistoryFeedback(null); }}
                className={`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                  manageDataTab === 'history' ? 'bg-white text-blue-600 shadow' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                3-Year History Import
              </button>
              <button
                onClick={() => { setManageDataTab('upload_history'); setReportFeedback(null); setHistoryFeedback(null); }}
                className={`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                  manageDataTab === 'upload_history' ? 'bg-white text-blue-600 shadow' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Upload History
              </button>
            </div>

            {manageDataTab === 'excel' ? (
              /* Standard Excel Grid Cards */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {factories.map(factory => (
                  <FactoryCard key={factory.id} factory={factory} />
                ))}
              </div>
            ) : manageDataTab === 'system' ? (
              /* Daily System Reports (SAP / Oracle) Form */
              <div className="bg-white rounded-3xl border border-gray-200/50 p-8 shadow-sm max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  {/* Factory Selection */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Target Factory</label>
                    <select
                      value={selectedReportFactory}
                      onChange={(e) => { setSelectedReportFactory(e.target.value); setReportFeedback(null); }}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 outline-none text-sm transition-all cursor-pointer font-semibold text-gray-700"
                    >
                      {factories.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                    </select>
                  </div>

                  {/* System Selection */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">ERP System Vendor</label>
                    <div className="flex bg-gray-50 p-1.5 rounded-xl border border-gray-200">
                      <button
                        type="button"
                        onClick={() => { setSelectedSystem('SAP'); setSelectedReportType('MB52'); setReportFeedback(null); }}
                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                          selectedSystem === 'SAP' ? 'bg-white text-blue-600 shadow' : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        SAP ERP
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSelectedSystem('Oracle'); setSelectedReportType('SUBINVENTORY'); setReportFeedback(null); }}
                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                          selectedSystem === 'Oracle' ? 'bg-white text-blue-600 shadow' : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Oracle ERP
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  {/* Report Type Select */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">System Report Type</label>
                    <select
                      value={selectedReportType}
                      onChange={(e) => { setSelectedReportType(e.target.value); setReportFeedback(null); }}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 outline-none text-sm transition-all cursor-pointer font-semibold text-gray-700"
                    >
                      {selectedSystem === 'SAP' ? (
                        <>
                          <option value="MB52">MB52 — Warehouse Stock Report (Updates stock)</option>
                          <option value="MB51">MB51 — Material Document List (Subtracts daily consumption)</option>
                        </>
                      ) : (
                        <>
                          <option value="SUBINVENTORY">Subinventory Quantity Report (Updates stock)</option>
                          <option value="TRANSACTION">Material Transaction Report (Subtracts daily consumption)</option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* File Upload Actions */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Select & Upload File</label>
                    <label className={`
                      w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-50 text-blue-600 border-2 border-dashed border-blue-200 hover:border-blue-400 rounded-xl text-sm font-bold text-center cursor-pointer transition-all duration-200
                      ${isProcessingReport ? 'opacity-50 pointer-events-none' : ''}
                    `}>
                      {isProcessingReport ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Processing report...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          <span>Choose Report Excel/CSV</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept=".xlsx, .xls, .csv"
                        onChange={handleSystemReportUpload}
                        className="hidden"
                        disabled={isProcessingReport}
                      />
                    </label>
                  </div>
                </div>

                {reportFeedback && (
                  <div className="mt-6 p-5 bg-green-50 border border-green-100 text-green-800 rounded-2xl flex items-start gap-3 animate-in fade-in zoom-in duration-200">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wider text-green-900">Upload Processed Successfully</h4>
                      <p className="text-xs mt-1 leading-relaxed font-semibold">{reportFeedback}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : manageDataTab === 'history' ? (
              /* 3-Year Historical Consumption Upload Form */
              <div className="bg-white rounded-3xl border border-gray-200/50 p-8 shadow-sm max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-gray-900">Upload 3-Year Historical Consumption Log</h3>
                    <p className="text-xs text-gray-500 mt-1 font-semibold">Select a CSV or Excel file containing the last 3 years of consumption data. The records will be automatically grouped and mapped to the 4 factories.</p>
                  </div>
                  
                  <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl text-xs font-semibold text-blue-800 leading-relaxed">
                    <strong>Expected Columns:</strong> Factory Name (or Plant / Location), Year (e.g. 2023, 2024, 2025), Qty Consumed (or Quantity), Consumption Value (or Cost / Amount in Rs.)
                  </div>

                  {/* Target Factory Selector */}
                  <div className="space-y-2 max-w-md">
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Target Factory</label>
                    <select
                      value={selectedHistoryFactory}
                      onChange={(e) => { setSelectedHistoryFactory(e.target.value); setHistoryFeedback(null); }}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 outline-none text-sm transition-all cursor-pointer font-semibold text-gray-700"
                    >
                      <option value="All">All Factories (Auto-detect from file)</option>
                      {factories.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Select & Upload Historical File</label>
                    <label className={`
                      w-full flex items-center justify-center gap-2 px-4 py-4 bg-blue-50 text-blue-600 border-2 border-dashed border-blue-200 hover:border-blue-400 rounded-xl text-sm font-bold text-center cursor-pointer transition-all duration-200
                      ${isProcessingHistory ? 'opacity-50 pointer-events-none' : ''}
                    `}>
                      {isProcessingHistory ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Processing history log...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          <span>Choose History Excel/CSV</span>
                        </>
                      )}
                      <input
                        id="history-upload-input"
                        type="file"
                        accept=".xlsx, .xls, .csv"
                        onChange={handleHistoricalConsumptionUpload}
                        className="hidden"
                        disabled={isProcessingHistory}
                      />
                    </label>
                  </div>
                </div>

                {historyFeedback && (
                  <div className="mt-6 p-5 bg-green-50 border border-green-100 text-green-800 rounded-2xl flex items-start gap-3 animate-in fade-in zoom-in duration-200">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wider text-green-900">Historical Import Complete</h4>
                      <p className="text-xs mt-1 leading-relaxed font-semibold">{historyFeedback}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Upload History list */
              <div className="bg-white rounded-3xl border border-gray-200/50 p-8 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-base font-bold text-gray-900">Upload History & Reversion Logs</h3>
                    <p className="text-xs text-gray-500 mt-1 font-semibold">View all imported datasets and system reports. You can revert any upload to restore the inventory values to their previous state.</p>
                  </div>
                  <button
                    onClick={async () => {
                      setLoadingDB(true);
                      try {
                        const historyLogs = await getUploadHistory();
                        setUploadHistory(historyLogs);
                      } catch (e) {
                        console.error(e);
                      } finally {
                        setLoadingDB(false);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-xs text-gray-600 rounded-xl font-bold cursor-pointer transition-all"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh Logs
                  </button>
                </div>

                <div className="overflow-x-auto">
                  {uploadHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400 space-y-2">
                      <Database className="w-8 h-8 text-gray-300" />
                      <span className="text-xs font-bold">No upload history records found.</span>
                      <p className="text-[10px] text-center max-w-[280px] leading-normal font-medium font-semibold">New uploads will be logged here with option to revert changes.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 text-[10px] font-black uppercase text-gray-400 tracking-wider">
                          <th className="pb-3 pl-4">Time</th>
                          <th className="pb-3">User</th>
                          <th className="pb-3">Target Factory</th>
                          <th className="pb-3">Source/File</th>
                          <th className="pb-3">Report Type</th>
                          <th className="pb-3 text-center">Items Affected</th>
                          <th className="pb-3 pr-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-semibold text-gray-700">
                        {uploadHistory.map((item) => {
                          const dateStr = new Date(item.timestamp).toLocaleString();
                          const prevCount = Object.keys(item.previousState || {}).length;
                          const isReverting = isRevertingUpload === item.id;
                          
                          return (
                            <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="py-4 pl-4 font-bold text-gray-900">{dateStr}</td>
                              <td className="py-4">{item.uploadedBy}</td>
                              <td className="py-4">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold">
                                  {item.factoryId}
                                </span>
                              </td>
                              <td className="py-4 truncate max-w-[150px]" title={item.fileName}>
                                {item.fileName}
                              </td>
                              <td className="py-4">
                                <span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                  {item.reportType}
                                </span>
                              </td>
                              <td className="py-4 text-center font-bold text-gray-900">{prevCount}</td>
                              <td className="py-4 pr-4 text-right">
                                <button
                                  onClick={async () => {
                                    const confirmRevert = confirm(
                                      `Are you sure you want to revert this upload? \n\nThis will restore the previous stock and consumption values for the ${prevCount} affected items in ${item.factoryId}, and delete any new catalog items added by this file.`
                                    );
                                    if (confirmRevert) {
                                      setIsRevertingUpload(item.id);
                                      try {
                                        await revertUpload(item.id, currentUser?.username || 'unknown');
                                        await refreshData();
                                        alert("Upload successfully reverted and database restored!");
                                      } catch (err) {
                                        console.error(err);
                                        alert(`Reversion failed: ${(err as any).message || String(err)}`);
                                      } finally {
                                        setIsRevertingUpload(null);
                                      }
                                    }
                                  }}
                                  disabled={isReverting}
                                  className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 rounded-lg transition-colors inline-flex items-center justify-center cursor-pointer disabled:opacity-50"
                                  title="Revert & Delete Upload Data"
                                >
                                  {isReverting ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Control Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-white/80 backdrop-blur-md p-6 rounded-[2rem] border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">

              {/* Search & Actions */}
              <div className="flex flex-col sm:flex-row items-center gap-4 flex-1">
                {activeTab !== 'orders' && (
                  <div className="relative flex-1 w-full max-w-sm group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <input
                      type="text"
                      placeholder="Search parts catalog..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-gray-50/50 border border-gray-200/60 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 focus:bg-white outline-none text-sm transition-all shadow-inner font-medium"
                    />
                  </div>
                )}

                {/* Admin Quick Actions */}
                {currentUser.role === 'admin' && activeTab !== 'orders' && (
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <button
                      onClick={() => setShowAddItemModal(true)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:shadow-xl hover:shadow-blue-200 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300"
                    >
                      <Plus className="w-4 h-4" />
                      Add Item
                    </button>

                    <button
                      onClick={() => setShowUploadModal(true)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-white border border-gray-200 text-gray-700 text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-gray-50 hover:border-gray-300 hover:shadow-md transition-all duration-300"
                    >
                      <Database className="w-4 h-4" />
                      Manage Data
                    </button>

                    <button
                      onClick={async () => {
                        const confirmReset = confirm("WARNING: This will delete ALL inventory and order history. Are you sure?");
                        if (confirmReset) {
                          setLoadingDB(true);
                          try {
                            await clearDatabase(currentUser.username);
                            await refreshData();
                            alert("System reset successful. Inventory and orders have been cleared.");
                          } catch (e) {
                            console.error(e);
                            alert("Failed to clear data. Please check your internet connection.");
                          } finally {
                            setLoadingDB(false);
                          }
                        }
                      }}
                      className="p-3 text-red-500 bg-red-50/50 border border-red-100 rounded-2xl hover:bg-red-50 hover:text-red-600 transition-all hover:shadow-lg hover:shadow-red-200"
                      title="Clear All Data (Core Reset)"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Faceted Filter Bar (Inventory View Only) */}
            {activeTab === 'inventory' && (
              <div className="flex flex-wrap items-center gap-4 bg-white/40 backdrop-blur-sm p-4 rounded-3xl border border-white/60 shadow-sm animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/80 rounded-xl border border-gray-200 shadow-tiny overflow-hidden max-w-[200px]">
                  <span className="text-[10px] font-black uppercase text-gray-400 shrink-0">Plant:</span>
                  <select 
                    value={factoryFilter}
                    onChange={(e) => setFactoryFilter(e.target.value)}
                    className="text-xs font-bold text-gray-700 bg-transparent outline-none focus:ring-0 border-none cursor-pointer truncate"
                  >
                    <option value="">All Plants</option>
                    {factories.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                  </select>
                </div>

                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/80 rounded-xl border border-gray-200 shadow-tiny overflow-hidden max-w-[200px]">
                  <span className="text-[10px] font-black uppercase text-gray-400 shrink-0">Class:</span>
                  <select 
                    value={criticalityFilter}
                    onChange={(e) => setCriticalityFilter(e.target.value)}
                    className="text-xs font-bold text-gray-700 bg-transparent outline-none focus:ring-0 border-none cursor-pointer truncate"
                  >
                    <option value="">All Classes</option>
                    <option value="Vital">Vital (V)</option>
                    <option value="Essential">Essential (E)</option>
                    <option value="Desirable">Desirable (D)</option>
                    <option value="Non Using">Non Using</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/80 rounded-xl border border-gray-200 shadow-tiny overflow-hidden max-w-[200px]">
                  <span className="text-[10px] font-black uppercase text-gray-400 shrink-0">Has Image:</span>
                  <select 
                    value={imageFilter}
                    onChange={(e) => setImageFilter(e.target.value)}
                    className="text-xs font-bold text-gray-700 bg-transparent outline-none focus:ring-0 border-none cursor-pointer truncate"
                  >
                    <option value="all">All</option>
                    <option value="with">With Pictures Only</option>
                    <option value="without">Without Pictures Only</option>
                  </select>
                </div>

                {(factoryFilter || categoryFilter || criticalityFilter || imageFilter !== 'all') && (
                  <button 
                    onClick={() => { setFactoryFilter(''); setCategoryFilter(''); setCriticalityFilter(''); setImageFilter('all'); }}
                    className="text-[10px] font-black uppercase text-red-500 hover:text-red-600 px-3 transition-colors"
                  >
                    Clear Filters
                  </button>
                )}

                <div className="ml-auto flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400">{filteredParts.length} Results</span>
                  <button 
                    onClick={handleExportCSV}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-emerald-100 border border-emerald-100 transition-all"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                </div>
              </div>
            )}

            {/* Main Content Area */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
              {loadingDB ? (
                <div className="text-center py-20 text-gray-500">Loading Database...</div>
              ) : (
                <>
                  {activeTab === 'dashboard' && (
                    <div className="space-y-6">
                      {/* Sub-tabs header */}
                      <div className="flex items-center justify-between border-b border-gray-200/60 pb-2">
                        <div className="flex gap-6">
                          <button
                            onClick={() => setDashboardSubTab('overview')}
                            className={`pb-2 text-sm font-bold border-b-2 transition-all ${
                              dashboardSubTab === 'overview' 
                                ? 'border-blue-600 text-blue-600' 
                                : 'border-transparent text-gray-400 hover:text-gray-600'
                            }`}
                          >
                            Overview
                          </button>
                          <button
                            onClick={() => setDashboardSubTab('consumption')}
                            className={`pb-2 text-sm font-bold border-b-2 transition-all ${
                              dashboardSubTab === 'consumption' 
                                ? 'border-blue-600 text-blue-600' 
                                : 'border-transparent text-gray-400 hover:text-gray-600'
                            }`}
                          >
                            Consumption
                          </button>
                        </div>

                        {dashboardSubTab === 'consumption' && currentUser.role === 'admin' && (
                          <button
                            onClick={handleExportConsumptionExcel}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-100 border border-blue-100 transition-all"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            Download Excel
                          </button>
                        )}
                      </div>

                      {dashboardSubTab === 'overview' ? (
                        <DashboardStats 
                          parts={filteredParts} 
                          onFilterChange={(type, value) => {
                            if (type === 'factory') setFactoryFilter(value);
                            if (type === 'criticality') setCriticalityFilter(value);
                            setActiveTab('inventory');
                          }}
                        />
                      ) : (
                        <DashboardConsumptionView parts={parts} historicalConsumption={historicalConsumption} />
                      )}

                      {/* How-To Catalogue Guide */}
                      <DashboardGuide />
                    </div>
                  )}
                  {activeTab === 'inventory' && (
                    <div className="h-[70vh]">
                      <InventoryTable
                        data={filteredParts}
                        currentUser={currentUser}
                        onDataChange={refreshData}
                        cartItems={cartItems}
                        onAddToCart={handleAddToCart}
                      />
                    </div>
                  )}
                  {activeTab === 'orders' && <OrderManagement currentUser={currentUser} />}
                  {activeTab === 'users' && <UserManagement currentUser={currentUser} />}
                  {activeTab === 'audit' && <AuditLogs />}
                </>
              )}
            </div>
          </>
        )
        }
      </main >

      <AIInsights
        data={filteredParts}
        isOpen={showAI}
        onClose={() => setShowAI(false)}
      />

      <ChatBot allParts={parts} isOpen={isChatOpen} setIsOpen={setIsChatOpen} />

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems}
        currentUser={currentUser}
        onUpdateQty={handleUpdateCartQty}
        onRemoveItem={handleRemoveFromCart}
        onClearCart={handleClearCart}
      />

      <AddItemModal
        isOpen={showAddItemModal}
        onClose={() => setShowAddItemModal(false)}
        currentUser={currentUser}
        onSuccess={() => {
          refreshData();
          alert("Item added successfully!");
        }}
      />

      {uploadPreview && (
        <UploadPreviewModal
          isOpen={!!uploadPreview}
          onClose={() => { setUploadPreview(null); setProcessingFactory(null); }}
          onConfirm={confirmUpload}
          result={uploadPreview}
          isUploading={isConfirmingUpload}
        />
      )}

      {/* Global CSS Overrides for Dark Mode */}
      <style>{`
        body.dark-mode {
          background-color: #0f172a !important;
          color: #e2e8f0 !important;
        }
        body.dark-mode .min-h-screen {
          background-color: #0f172a !important;
        }
        body.dark-mode nav,
        body.dark-mode main,
        body.dark-mode .bg-white,
        body.dark-mode .bg-white\\/95,
        body.dark-mode .bg-white\\/85,
        body.dark-mode .bg-white\\/80,
        body.dark-mode .bg-white\\/70,
        body.dark-mode .bg-white\\/65,
        body.dark-mode .bg-white\\/50,
        body.dark-mode .bg-white\\/40,
        body.dark-mode .bg-gray-50,
        body.dark-mode .bg-gray-50\\/50,
        body.dark-mode .bg-gray-50\\/60,
        body.dark-mode .bg-gray-100,
        body.dark-mode .bg-gray-100\\/50,
        body.dark-mode .bg-gray-100\\/60,
        body.dark-mode .bg-slate-50,
        body.dark-mode div.bg-white,
        body.dark-mode div.bg-gray-50,
        body.dark-mode .bg-blue-50,
        body.dark-mode .bg-emerald-50,
        body.dark-mode .bg-rose-50,
        body.dark-mode .bg-amber-50,
        body.dark-mode .bg-purple-50,
        body.dark-mode .bg-indigo-50,
        body.dark-mode .bg-green-50,
        body.dark-mode select,
        body.dark-mode input,
        body.dark-mode table,
        body.dark-mode .prose,
        body.dark-mode textarea {
          background-color: #1e293b !important;
        }
        body.dark-mode select,
        body.dark-mode input,
        body.dark-mode textarea {
          background-color: #0f172a !important;
          color: #f8fafc !important;
        }
        body.dark-mode .text-gray-900,
        body.dark-mode .text-gray-800,
        body.dark-mode .text-gray-700,
        body.dark-mode .text-slate-900,
        body.dark-mode h1,
        body.dark-mode h2,
        body.dark-mode h3,
        body.dark-mode h4,
        body.dark-mode h5,
        body.dark-mode h6,
        body.dark-mode select,
        body.dark-mode input,
        body.dark-mode label,
        body.dark-mode th,
        body.dark-mode td {
          color: #f8fafc !important;
        }
        body.dark-mode .text-gray-600 {
          color: #cbd5e1 !important;
        }
        body.dark-mode .text-gray-500,
        body.dark-mode .text-gray-400,
        body.dark-mode .opacity-70 {
          color: #94a3b8 !important;
        }
        body.dark-mode .text-blue-900 {
          color: #f8fafc !important;
        }
        body.dark-mode .text-blue-800 {
          color: #60a5fa !important;
        }
        body.dark-mode .text-blue-600,
        body.dark-mode .text-blue-700 {
          color: #60a5fa !important;
        }
        body.dark-mode .bg-white.shadow,
        body.dark-mode button.bg-white.shadow {
          background-color: #334155 !important;
          color: #60a5fa !important;
        }
        body.dark-mode .border-gray-100,
        body.dark-mode .border-gray-200,
        body.dark-mode .border-gray-200\\/60,
        body.dark-mode .border-gray-200\\/50,
        body.dark-mode .border-slate-100,
        body.dark-mode .border-slate-200,
        body.dark-mode .border-white,
        body.dark-mode .border-white\\/60,
        body.dark-mode .border-white\\/40,
        body.dark-mode .border-white\\/20,
        body.dark-mode .border-blue-100,
        body.dark-mode .border-blue-200,
        body.dark-mode select,
        body.dark-mode input,
        body.dark-mode hr {
          border-color: #334155 !important;
        }
        body.dark-mode .hover\\:bg-gray-50:hover,
        body.dark-mode .hover\\:bg-gray-100:hover,
        body.dark-mode .hover\\:bg-red-50:hover,
        body.dark-mode tr:hover {
          background-color: #334155 !important;
        }
        body.dark-mode .bg-black\\/50 {
          background-color: rgba(0, 0, 0, 0.75) !important;
        }
        body.dark-mode .recharts-cartesian-axis-tick text {
          fill: #94a3b8 !important;
        }
        body.dark-mode .recharts-default-tooltip {
          background-color: #1e293b !important;
          border-color: #334155 !important;
        }
        body.dark-mode .recharts-default-tooltip .recharts-tooltip-item {
          color: #f8fafc !important;
        }
        body.dark-mode .recharts-legend-item-text {
          color: #cbd5e1 !important;
        }
      `}</style>
      </div>
    </div >
  );
}

export default App;