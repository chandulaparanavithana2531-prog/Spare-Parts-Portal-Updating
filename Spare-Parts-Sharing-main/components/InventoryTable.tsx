import React, { useState, useMemo } from 'react';
import { SparePart, SortField, SortDirection, User, CartItem } from '../types';
import { ArrowUpDown, ArrowUp, ArrowDown, MapPin, ShoppingCart, Loader2, Edit2, Save, X, Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Filter, ShoppingBag, Eye, Trash2, Upload, Download, CheckCircle, Image as ImageIcon } from 'lucide-react';
import { updateSparePart } from '../services/db';
import { ItemDetailsModal } from './ItemDetailsModal';
import { EditItemModal } from './EditItemModal'; // Import Edit Modal

interface InventoryTableProps {
  data: SparePart[];
  currentUser: User;
  onDataChange: () => void;
  cartItems: CartItem[];
  onAddToCart: (part: SparePart) => void;
}

export const InventoryTable: React.FC<InventoryTableProps> = ({
  data,
  currentUser,
  onDataChange,
  cartItems,
  onAddToCart
}) => {
  const [sortField, setSortField] = useState<SortField>(SortField.TOTAL_VALUE);
  const [sortDirection, setSortDirection] = useState<SortDirection>(SortDirection.DESC);
  const [page, setPage] = useState(1);
  const itemsPerPage = 20;
  const [pageInput, setPageInput] = useState('1');

  // --- Filtering State ---
  const [filters, setFilters] = useState({
    factoryId: '',
    machine: '',
    categoryName: ''
  });
  const [showFilters, setShowFilters] = useState(false);

  // --- Selection State (Bulk Actions) ---
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // --- Modal State ---
  const [selectedPart, setSelectedPart] = useState<SparePart | null>(null);
  const [editingPart, setEditingPart] = useState<SparePart | null>(null); // New state for editing
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Update input when page changes externally (e.g. via next/prev buttons)
  React.useEffect(() => {
    setPageInput(page.toString());
  }, [page]);

  const handlePageJump = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(pageInput);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= Math.ceil(processedData.length / itemsPerPage)) {
      setPage(pageNum);
    } else {
      setPageInput(page.toString()); // Reset if invalid
    }
  };

  // Editing State (Admin Only)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ onHand: number, unitCost: number }>({ onHand: 0, unitCost: 0 });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === SortDirection.ASC ? SortDirection.DESC : SortDirection.ASC);
    } else {
      setSortField(field);
      setSortDirection(SortDirection.DESC); // Default to desc for values usually
    }
  };

  // --- Unique Values for Filters ---
  const uniqueValues = useMemo(() => {
    const getUnique = (key: keyof SparePart) => Array.from(new Set(data.map(item => String(item[key] || '')).filter(Boolean))).sort();
    return {
      factories: getUnique('factoryId'),
      machines: getUnique('machine'),
      categories: getUnique('categoryName')
    };
  }, [data]);

  // --- Data Processing: Filter -> Sort ---
  const processedData = useMemo(() => {
    let result = [...data];

    // 1. Apply Filters
    if (filters.factoryId) result = result.filter(item => item.factoryId === filters.factoryId);
    if (filters.machine) result = result.filter(item => item.machine === filters.machine);
    if (filters.categoryName) result = result.filter(item => item.categoryName === filters.categoryName);

    // 2. Sort
    result.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (aVal < bVal) return sortDirection === SortDirection.ASC ? -1 : 1;
      if (aVal > bVal) return sortDirection === SortDirection.ASC ? 1 : -1;
      return 0;
    });

    return result;
  }, [data, filters, sortField, sortDirection]);

  // Reset page when filters change
  React.useEffect(() => {
    setPage(1);
    setSelectedIds(new Set()); // Clear selection on filter change to avoid confusion
  }, [filters]);

  const totalPages = Math.ceil(processedData.length / itemsPerPage);
  const paginatedData = processedData.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />;
    return sortDirection === SortDirection.ASC
      ? <ArrowUp className="w-3 h-3 ml-1 text-blue-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-blue-600" />;
  };

  const formatCurrency = (val: number) => {
    return `Rs. ${new Intl.NumberFormat('en-LK', { maximumFractionDigits: 2 }).format(val)}`;
  };

  const HeaderCell = ({ field, label, align = 'left', className = '' }: { field: SortField, label: string, align?: 'left' | 'right', className?: string }) => (
    <th
      className={`px-4 py-3 text-${align} text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer group hover:bg-gray-100 transition-colors whitespace-nowrap ${className}`}
      onClick={() => handleSort(field)}
    >
      <div className={`flex items-center ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {label}
        <SortIcon field={field} />
      </div>
    </th>
  );

  // --- Bulk Selection Handlers ---
  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedData.length) {
      setSelectedIds(new Set());
    } else {
      const newSet = new Set(selectedIds);
      paginatedData.forEach(item => newSet.add(item.id));
      setSelectedIds(newSet);
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handleBulkAddToCart = () => {
    const selectedItems = data.filter(item => selectedIds.has(item.id));
    selectedItems.forEach(item => onAddToCart(item));
    setSelectedIds(new Set());
    alert(`Added ${selectedItems.length} items to cart!`);
  };

  // --- Edit Handlers (Admin) ---

  const startEdit = (part: SparePart) => {
    setEditingId(part.id);
    setEditValues({ onHand: part.onHand, unitCost: part.unitCost });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  // --- Data & Reserved Stock ---
  const [orders, setOrders] = useState<import('../types').Order[]>([]);

  // Fetch orders to calculate reserved stock
  React.useEffect(() => {
    const loadOrders = async () => {
      try {
        const allOrders = await import('../services/db').then(m => m.getOrders({ username: 'admin', role: 'admin', approved: true })); // Fetch as admin to see all reservations
        setOrders(allOrders);
      } catch (e) {
        console.error("Failed to load orders for reservation calc", e);
      }
    };
    loadOrders();
  }, [data]); // Reload when data changes (e.g. after edit)

  // Memoize reserved stock calculation
  const reservedStock = useMemo(() => {
    const map = new Map<string, number>();
    orders.forEach(order => {
      if (order.status === 'pending' || order.status === 'approved') {
        order.items.forEach(item => {
          // Only count items that are APPROVED but NOT DELIVERED yet.
          // Pending items are queries, not reservations yet.
          // User said: "during the order accepted to delivering stage i need to show the users the available count and the accpeted order count"
          if (item.status === 'approved') {
            const current = map.get(item.sparePartId) || 0;
            map.set(item.sparePartId, current + item.quantity);
          }
        });
      }
    });
    return map;
  }, [orders]);

  const saveEdit = async (part: SparePart) => {
    const updatedPart = {
      ...part,
      onHand: editValues.onHand,
      unitCost: editValues.unitCost,
      totalValue: editValues.onHand * editValues.unitCost
    };
    await updateSparePart(updatedPart, currentUser.username);
    setEditingId(null);
    onDataChange(); // Refresh data
  };

  // --- View Details ---
  const handleViewDetails = (part: SparePart) => {
    setSelectedPart(part);
    setIsModalOpen(true);
  }

  const onEditItem = (part: SparePart) => {
    setEditingPart(part);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-full overflow-hidden">

      {/* --- Filter Bar --- */}
      <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg border transition-colors flex items-center gap-2 text-sm font-medium ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'}`}
          >
            <Filter className="w-4 h-4" /> Filters
          </button>

          <button
            onClick={() => {
              // Convert processedData to CSV
              const headers = ['Spare Type', 'Item Code', 'Part Number', 'Description', 'Criticality', 'Machine', 'Category', 'Available', 'Reserved', 'Unit Cost', 'Total Value', 'Factory'];
              const csvContent = [
                headers.join(','),
                ...processedData.map(item => {
                  const reserved = reservedStock.get(item.id) || 0;
                  const available = item.onHand - reserved;
                  return [
                    `"${item.spareType || ''}"`,
                    `"${item.materialNumber || ''}"`,
                    `"${item.partNumber || ''}"`,
                    `"${(item.description || '').replace(/"/g, '""')}"`, // Escape quotes
                    `"${item.criticality || ''}"`,
                    `"${item.machine || ''}"`,
                    `"${item.categoryName || ''}"`,
                    available,
                    reserved,
                    item.unitCost,
                    available * item.unitCost, // Total Value based on available
                    `"${item.factoryId || ''}"`
                  ].join(',');
                })
              ].join('\n');

              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.setAttribute('href', url);
              link.setAttribute('download', `inventory_export_${new Date().toISOString().split('T')[0]}.csv`);
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
            className="p-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-2 text-sm font-medium"
            title="Download Filtered Data as CSV"
          >
            <Download className="w-4 h-4" /> Export
          </button>

          {showFilters && (
            <div className="flex items-center gap-2 animate-in slide-in-from-left-2 duration-200">
              <select
                value={filters.factoryId}
                onChange={(e) => setFilters({ ...filters, factoryId: e.target.value })}
                className="text-xs p-2 rounded border border-gray-300 bg-white focus:border-blue-500 focus:outline-none"
              >
                <option value="">All Factories</option>
                {uniqueValues.factories.map(f => <option key={f} value={f}>{f}</option>)}
              </select>

              <select
                value={filters.categoryName}
                onChange={(e) => setFilters({ ...filters, categoryName: e.target.value })}
                className="text-xs p-2 rounded border border-gray-300 bg-white focus:border-blue-500 focus:outline-none max-w-[150px]"
              >
                <option value="">All Categories</option>
                {uniqueValues.categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              <select
                value={filters.machine}
                onChange={(e) => setFilters({ ...filters, machine: e.target.value })}
                className="text-xs p-2 rounded border border-gray-300 bg-white focus:border-blue-500 focus:outline-none max-w-[150px]"
              >
                <option value="">All Machines</option>
                {uniqueValues.machines.map(m => <option key={m} value={m}>{m}</option>)}
              </select>

              {(filters.factoryId || filters.categoryName || filters.machine) && (
                <button
                  onClick={() => setFilters({ factoryId: '', machine: '', categoryName: '' })}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                  title="Clear Filters"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Selection Actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 bg-blue-50 px-3 py-1 rounded-lg border border-blue-100 animate-in fade-in zoom-in duration-200">
            <span className="text-xs font-bold text-blue-800">{selectedIds.size} selected</span>
            <div className="h-4 w-px bg-blue-200 mx-1"></div>
            <button
              onClick={handleBulkAddToCart}
              className="text-xs font-medium text-blue-700 hover:text-blue-900 flex items-center gap-1"
            >
              <ShoppingBag className="w-3 h-3" /> Add to Cart
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto flex-1">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {/* Image Column */}
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap w-20">Image</th>

              {/* Checkbox Column */}
              <th className="px-4 py-3 w-4">
                <input
                  type="checkbox"
                  checked={paginatedData.length > 0 && selectedIds.size === paginatedData.length}
                  onChange={toggleSelectAll}
                  disabled={paginatedData.length === 0}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </th>

              <HeaderCell field={SortField.SPARE_TYPE} label="Spare Type" />
              <HeaderCell field={SortField.MATERIAL_NUMBER} label="Item Code" />
              <HeaderCell field={SortField.PART_NUMBER} label="Part No" />
              <HeaderCell field={SortField.DESCRIPTION} label="Description" className="min-w-[200px]" />
              <HeaderCell field={SortField.CRITICALITY} label="Criticality" />
              <HeaderCell field={SortField.MACHINE} label="Machine" />
              <HeaderCell field={SortField.CATEGORY} label="Sub Category" />
              <HeaderCell field={SortField.ON_HAND} label="Available" align="right" />
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Reserved</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Unit Value</th>
              <HeaderCell field={SortField.TOTAL_VALUE} label="Total Value" align="right" />
              <HeaderCell field={SortField.FACTORY} label="Factory" />
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200 text-sm">
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-6 py-12 text-center text-gray-500">
                  No parts found matching your criteria.
                </td>
              </tr>
            ) : (
              paginatedData.map((part) => {
                const isEditing = editingId === part.id;
                const inCart = cartItems.some(item => item.id === part.id);
                const isSelected = selectedIds.has(part.id);

                return (
                  <tr key={part.id} className={`hover:bg-blue-50/50 transition-colors ${isSelected ? 'bg-blue-50/30' : ''}`}>

                    {/* Image Column */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {part.imageUrl || part.image_url ? (
                        <div 
                          className="w-[60px] h-[60px] rounded-xl overflow-hidden border border-gray-250 shadow-sm relative group cursor-pointer hover:scale-105 transition-all duration-200 flex items-center justify-center bg-gray-50 flex-shrink-0"
                          onClick={() => handleViewDetails(part)}
                          title="Click to view details & photos"
                        >
                          <img
                            src={(part.imageUrl || part.image_url || '').split(/[\s,]+/)[0]}
                            alt={part.description}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = 'https://placehold.co/100x100?text=No+Image';
                            }}
                          />
                        </div>
                      ) : (
                        <div 
                          className="w-[60px] h-[60px] bg-gray-50 border border-dashed border-gray-300 rounded-xl flex items-center justify-center text-gray-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50/50 transition-all cursor-pointer flex-shrink-0"
                          onClick={() => onEditItem(part)}
                          title={currentUser.role === 'admin' ? "Upload photo" : "Request photo upload"}
                        >
                          <ImageIcon className="w-6 h-6 text-gray-400" />
                        </div>
                      )}
                    </td>

                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(part.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{part.spareType}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-blue-600 cursor-pointer hover:underline" onClick={() => handleViewDetails(part)}>{part.materialNumber}</td>

                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">{part.partNumber}</td>
                    <td className="px-4 py-3 text-gray-900 min-w-[200px] cursor-pointer" onClick={() => handleViewDetails(part)} title={part.description}>
                      <div className="truncate max-w-xs hover:text-blue-600">{part.description}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {(() => {
                        const raw = (part.criticality || '').trim().toLowerCase();
                        const rawDesc = (part.description || '').trim().toLowerCase();
                        
                        let label = part.criticality || '-';
                        let badgeClass = 'bg-gray-100 text-gray-600';

                        if (raw.includes('non') || raw.includes('unused') || rawDesc.includes('non using')) {
                          label = 'Non Using';
                          badgeClass = 'bg-indigo-100 text-indigo-700 border border-indigo-200';
                        } else if (raw.includes('vita')) {
                          label = 'Vital';
                          badgeClass = 'bg-red-100 text-red-700 border border-red-200';
                        } else if (raw.includes('essen')) {
                          label = 'Essential';
                          badgeClass = 'bg-amber-100 text-amber-700 border border-amber-200';
                        } else if (raw.includes('desir') || raw.includes('norm')) {
                          label = 'Desirable';
                          badgeClass = 'bg-emerald-100 text-emerald-700 border border-emerald-200';
                        }

                        return (
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${badgeClass}`}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{part.machine}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{part.categoryName}</td>

                    {/* Editable Stock (Available) */}
                    <td className="px-4 py-3 whitespace-nowrap text-right font-medium text-gray-900">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editValues.onHand}
                          onChange={(e) => setEditValues({ ...editValues, onHand: Number(e.target.value) })}
                          className="w-20 px-1 py-0.5 border rounded text-right"
                        />
                      ) : (
                        // Show Available = OnHand - Reserved
                        <span className="text-gray-900">
                          {part.onHand - (reservedStock.get(part.id) || 0)}
                        </span>
                      )}
                    </td>

                    {/* Reserved Stock Column */}
                    <td className="px-4 py-3 whitespace-nowrap text-right font-medium text-orange-600">
                      {reservedStock.get(part.id) ? reservedStock.get(part.id) : '-'}
                    </td>

                    {/* Editable Cost */}
                    <td className="px-4 py-3 whitespace-nowrap text-right text-gray-500">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editValues.unitCost}
                          onChange={(e) => setEditValues({ ...editValues, unitCost: Number(e.target.value) })}
                          className="w-24 px-1 py-0.5 border rounded text-right"
                        />
                      ) : formatCurrency(part.unitCost)}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap text-right font-bold text-gray-900">
                      {formatCurrency(isEditing ? editValues.onHand * editValues.unitCost : part.totalValue)}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap text-gray-400 text-xs">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {part.factoryId}
                      </div>
                    </td>

                    {/* Action Column */}
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleViewDetails(part)}
                          className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {/* Admin: Full Edit | User: Upload Image Only */}
                        {currentUser.role === 'admin' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onEditItem(part); }}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Edit Details & Image"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        ) : (
                          <div className="flex gap-1 justify-center">
                            <button
                              onClick={(e) => { e.stopPropagation(); onEditItem(part); }}
                              className="p-1.5 rounded transition-colors text-blue-600 hover:bg-blue-50"
                              title="Upload Image (Only)"
                            >
                              <Upload className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onAddToCart(part); }}
                              className={`p-1.5 rounded transition-colors flex items-center justify-center ${inCart
                                ? 'bg-orange-100 text-orange-700 border border-orange-200'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                                }`}
                              title={inCart 
                                ? (part.factoryId !== currentUser.factoryAffiliation ? "Requested from another plant" : "Already in cart") 
                                : (part.factoryId !== currentUser.factoryAffiliation ? "Request Part from another plant" : "Add to Cart")
                              }
                            >
                              {inCart ? (
                                <CheckCircle className="w-3.5 h-3.5" />
                              ) : (
                                <Plus className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50 rounded-b-xl">
        <div className="text-sm text-gray-500">
          Showing <span className="font-medium">{(page - 1) * itemsPerPage + 1}</span> - <span className="font-medium">{Math.min(page * itemsPerPage, processedData.length)}</span> of <span className="font-medium">{processedData.length}</span> results
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1 mr-4">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="p-2 text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="First Page"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handlePageJump} className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Page</span>
            <input
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={handlePageJump}
              className="w-12 h-9 text-center text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
            <span className="text-sm text-gray-600">of {totalPages || 1}</span>
          </form>

          <div className="flex gap-1 ml-4">
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || totalPages === 0}
              className="p-2 text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages || totalPages === 0}
              className="p-2 text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Last Page"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Item Details Modal */}
      {selectedPart && (
        <ItemDetailsModal
          isOpen={isModalOpen}
          onClose={() => { setIsModalOpen(false); setSelectedPart(null); }}
          part={selectedPart}
          reservedQuantity={reservedStock.get(selectedPart.id) || 0}
          onAddToCart={onAddToCart}
          currentUser={currentUser}
          onSuccess={onDataChange}
        />
      )}

      <EditItemModal
        isOpen={!!editingPart}
        onClose={() => setEditingPart(null)}
        onSuccess={() => {
          onDataChange();
          setEditingPart(null);
        }}
        part={editingPart}
        currentUser={currentUser}
        imageUploadOnly={currentUser.role !== 'admin'}
      />
    </div>
  );
};