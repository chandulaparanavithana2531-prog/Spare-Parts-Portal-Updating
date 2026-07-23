import React, { useEffect, useState } from 'react';
import { Order, OrderStatus, User } from '../types';
import { getOrders, processOrderItem, clearOrders } from '../services/db';
import { CheckCircle, XCircle, ChevronDown, ChevronUp, User as UserIcon, ArrowRight, ArrowLeft, Trash2, RotateCcw } from 'lucide-react';

interface OrderManagementProps {
  currentUser: User;
}

export const OrderManagement: React.FC<OrderManagementProps> = ({ currentUser }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

  const fetchOrders = async () => {
    setLoading(true);
    const data = await getOrders(currentUser);
    // Sort by Date (newest first)
    setOrders(data.sort((a, b) => b.createdAt - a.createdAt));
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();
  }, [currentUser]);

  // Deep linking: auto-expand order details from URL parameters
  useEffect(() => {
    if (orders.length === 0) return;
    
    const pathParts = window.location.pathname.split('/');
    const ordersIndex = pathParts.indexOf('orders');
    let targetOrderId = '';
    
    if (ordersIndex !== -1 && pathParts.length > ordersIndex + 1) {
      targetOrderId = pathParts[ordersIndex + 1];
    } else {
      const params = new URLSearchParams(window.location.search);
      targetOrderId = params.get('orderId') || '';
    }

    if (targetOrderId) {
      setExpandedOrders(prev => {
        const next = new Set(prev);
        next.add(targetOrderId);
        return next;
      });
      
      // Smooth scroll to the targeted order card
      setTimeout(() => {
        const element = document.getElementById(`order-card-${targetOrderId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
    }
  }, [orders]);

  const handleProcess = async (orderId: string, itemId: string, status: OrderStatus) => {
    try {
      if (confirm(`Are you sure you want to ${status} this item?`)) {
        await processOrderItem(orderId, itemId, status, currentUser.username);
        await fetchOrders();
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const toggleExpand = (orderId: string) => {
    const newSet = new Set(expandedOrders);
    if (newSet.has(orderId)) {
      newSet.delete(orderId);
    } else {
      newSet.add(orderId);
    }
    setExpandedOrders(newSet);
  };

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case 'approved': return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-yellow-50 text-yellow-800 border-yellow-200';
    }
  };

  const formatCurrency = (val: number) => {
    return `Rs. ${new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 }).format(val)}`;
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading orders...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">Order Requests</h2>
          <span className="bg-blue-100 text-blue-800 text-xs font-medium px-3 py-1 rounded-full">
            {orders.filter(o => o.status === 'pending').length} Pending
          </span>
        </div>

        {currentUser.role === 'admin' && orders.length > 0 && (
          <button
            onClick={async () => {
              if (confirm("WARNING: This will delete ALL order history permanently. Are you sure?")) {
                try {
                  setLoading(true);
                  await clearOrders(currentUser.username);
                  await fetchOrders();
                  alert("Order history cleared.");
                } catch (e) {
                  console.error(e);
                  alert("Failed to clear orders.");
                } finally {
                  setLoading(false);
                }
              }
            }}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-600 border border-red-100 rounded-lg hover:bg-red-100 text-xs font-bold transition-colors"
          >
            <Trash2 className="w-3 h-3" /> Clear History
          </button>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100 text-gray-500">
          No orders found.
        </div>
      ) : (
        <div className="grid gap-6">
          {orders.map((order) => {
            const isExpanded = expandedOrders.has(order.id);
            const itemCount = order.items ? order.items.length : 0;

            // Logic: Is this an Incoming Request (For me to approve)?
            const isIncoming = currentUser.role === 'admin' || (order.items && order.items.length > 0 && order.items[0].fromFactory === currentUser.factoryAffiliation);

            // Logic: Is this my own request? (I shouldn't approve my own)
            const isMyRequest = order.requestedBy === currentUser.username;

            // Only show actions if it's Incoming AND NOT my own request (unless admin debugging)
            const showActions = order.status === 'pending' && isIncoming && !isMyRequest;

            // If Incoming, Filter items to only show those for MY factory
            const displayItems = isIncoming && currentUser.factoryAffiliation
              ? order.items.filter(item => item.fromFactory === currentUser.factoryAffiliation)
              : order.items;

            return (
              <div id={`order-card-${order.id}`} key={order.id} className={`bg-white rounded-xl border shadow-sm transition-all overflow-hidden ${order.status === 'pending' ? 'border-blue-200 ring-1 ring-blue-50' : 'border-gray-200 opacity-90'}`}>
                {/* Order Header Summary */}
                <div
                  className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleExpand(order.id)}
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-full ${order.status === 'pending' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                      {isIncoming ? <ArrowRight className="w-5 h-5 text-green-600" /> : <ArrowLeft className="w-5 h-5 text-orange-500" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${isIncoming ? 'bg-green-50 text-green-700 border-green-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                                {isIncoming ? 'INCOMING REQUEST' : 'SENT REQUEST'}
                              </span>
                              <h3 className="font-bold text-gray-900">{order.requestedBy}</h3>
                              <span className="text-xs text-gray-400">• {new Date(order.createdAt).toLocaleString()}</span>
                            </div>
                            <p className="text-sm text-gray-600 mt-1">
                              {isIncoming ? (
                                <>
                                  Targeting <span className="font-semibold text-green-700">Your Plant</span> • {displayItems ? displayItems.length : 0} items
                                </>
                              ) : (
                                <>
                                  Sent to <span className="font-semibold text-orange-700">{order.items && order.items.length > 0 ? order.items[0].fromFactory : 'Unknown'}</span> • {displayItems ? displayItems.length : 0} items
                                </>
                              )}
                            </p>
                          </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right mr-2 hidden sm:block">
                      <div className="font-bold text-gray-900">{formatCurrency(order.totalValue)}</div>
                    </div>

                    {/* Status Badge Logic */}
                    {(() => {
                      const total = displayItems ? displayItems.length : 0;
                      const approved = displayItems ? displayItems.filter(i => i.status === 'approved').length : 0;
                      // const rejected = displayItems ? displayItems.filter(i => i.status === 'rejected').length : 0;

                      // If the main order is still pending/open, we might still show 'Pending' 
                      // or we can show 'Partial' if some work has started.
                      // For now, let's stick to the user request: "rejected place represent how much of the order fulfilled"

                      let badgeText = order.status.toUpperCase();
                      let badgeColor = getStatusColor(order.status);

                      if (order.status !== 'pending') {
                        badgeText = `${approved} / ${total} FULFILLED`;

                        if (approved === 0) {
                          badgeColor = 'bg-red-100 text-red-700 border-red-200'; // All Rejected
                        } else if (approved === total) {
                          // Check if all are delivered
                          const delivered = displayItems ? displayItems.filter(i => i.status === 'delivered').length : 0;
                          if (delivered === total) {
                            badgeColor = 'bg-purple-100 text-purple-700 border-purple-200'; // All Delivered
                            badgeText = "DELIVERED";
                          } else {
                            badgeColor = 'bg-green-100 text-green-700 border-green-200'; // All Approved (Pending Delivery)
                          }
                        } else {
                          badgeColor = 'bg-orange-100 text-orange-700 border-orange-200'; // Partial
                        }
                      }

                      return (
                        <span className={`px-3 py-1 text-xs font-bold uppercase tracking-wide rounded-full border ${badgeColor}`}>
                          {badgeText}
                        </span>
                      );
                    })()}

                    {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                  </div>
                </div>

                {/* Expanded Items List */}
                {isExpanded && displayItems && (
                  <div className="bg-gray-50/50 p-5 border-t border-gray-100 animate-in slide-in-from-top-2 duration-200">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-gray-500 uppercase bg-gray-100/50">
                        <tr>
                          <th className="px-4 py-2 rounded-l-lg">Part Description</th>
                          <th className="px-4 py-2">Factory</th>
                          <th className="px-4 py-2 text-center">Qty</th>
                          <th className="px-4 py-2 text-right">Cost</th>
                          <th className="px-4 py-2 text-center rounded-r-lg">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {displayItems.map((item, idx) => (
                          <tr key={`${order.id}-item-${idx}`} className="hover:bg-white transition-colors">
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {item.sparePartDescription}
                              <div className="text-xs text-gray-400 font-normal">{item.sparePartId}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-600">{item.fromFactory}</td>
                            <td className="px-4 py-3 text-center font-semibold text-gray-900">{item.quantity}</td>
                            <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(item.totalValue)}</td>

                            {/* Actions Column */}
                            <td className="px-4 py-3 text-center">
                              {/* If item is already processed, show status. If pending and proper user, show buttons */}
                              {item.status !== 'pending' && item.status !== 'approved' ? (
                                <span className={`px-2 py-1 text-[10px] font-bold uppercase rounded border ${item.status === 'delivered' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                                  item.status === 'rejected' ? 'bg-red-50 text-red-600 border-red-100' :
                                    'bg-green-100 text-green-700 border-green-200'
                                  }`}>
                                  {item.status}
                                </span>
                              ) : (
                                showActions || (item.status === 'approved' && isIncoming) ? (
                                  <div className="flex items-center justify-center gap-2">
                                    {item.status === 'pending' && (
                                      <>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleProcess(order.id, item.sparePartId, 'approved'); }}
                                          className="p-1 rounded bg-green-50 text-green-600 hover:bg-green-600 hover:text-white border border-green-200 transition-colors"
                                          title="Approve Item"
                                        >
                                          <CheckCircle className="w-4 h-4" />
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleProcess(order.id, item.sparePartId, 'rejected'); }}
                                          className="p-1 rounded bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-200 transition-colors"
                                          title="Reject Item"
                                        >
                                          <XCircle className="w-4 h-4" />
                                        </button>
                                      </>
                                    )}
                                    {item.status === 'approved' && (
                                      <>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleProcess(order.id, item.sparePartId, 'delivered'); }}
                                          className="px-2 py-1 flex items-center gap-1 rounded bg-purple-50 text-purple-600 hover:bg-purple-600 hover:text-white border border-purple-200 transition-colors text-xs font-bold uppercase"
                                          title="Mark as Delivered (Deduct Stock)"
                                        >
                                          <CheckCircle className="w-3 h-3" /> Deliver
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleProcess(order.id, item.sparePartId, 'pending'); }}
                                          className="px-2 py-1 flex items-center gap-1 rounded bg-gray-50 text-gray-500 hover:bg-gray-200 hover:text-gray-700 border border-gray-200 transition-colors text-xs font-bold uppercase"
                                          title="Undo Confirmation"
                                        >
                                          <RotateCcw className="w-3 h-3" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <span className={`text-[10px] font-bold uppercase rounded border px-2 py-1 ${item.status === 'approved' ? 'bg-green-100 text-green-700 border-green-200' : 'text-gray-400 border-transparent italic'
                                    }`}>
                                    {item.status}
                                  </span>
                                )
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
                }
              </div>
            );
          })}
        </div>
      )
      }
    </div >
  );
};