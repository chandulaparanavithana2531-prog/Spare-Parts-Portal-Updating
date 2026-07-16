import React, { useState } from 'react';
import { CartItem, User } from '../types';
import { createOrder } from '../services/db';
import { X, Trash2, ShoppingCart, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  currentUser: User;
  onUpdateQty: (id: string, qty: number) => void;
  onRemoveItem: (id: string) => void;
  onClearCart: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cartItems,
  currentUser,
  onUpdateQty,
  onRemoveItem,
  onClearCart
}) => {
  const [submitting, setSubmitting] = useState(false);

  // Validate cart: Check if any item exceeds stock
  const invalidItems = cartItems.filter(item => item.orderQty > item.onHand);
  const hasErrors = invalidItems.length > 0;

  const totalValue = cartItems.reduce((sum, item) => sum + (item.unitCost * item.orderQty), 0);

  const handleCheckout = async () => {
    if (hasErrors) {
      alert("Please correct the quantities in your cart. You cannot order more than available stock.");
      return;
    }

    setSubmitting(true);
    try {
      // Create single bulk order
      await createOrder(cartItems, currentUser.username);

      onClearCart();
      onClose();
      alert("Requests submitted successfully! They are now pending approval from the source factories.");
    } catch (error) {
      console.error(error);
      alert("Failed to submit one or more requests.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (val: number) => {
    return `Rs. ${new Intl.NumberFormat('en-LK', { maximumFractionDigits: 2 }).format(val)}`;
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div className={`fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-900">Request List ({cartItems.length})</h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {cartItems.length === 0 ? (
            <div className="text-center py-20 text-gray-400 flex flex-col items-center">
              <ShoppingCart className="w-16 h-16 mb-4 text-gray-200" />
              <p>Your request list is empty.</p>
              <button onClick={onClose} className="mt-4 text-blue-600 font-medium hover:underline">Browse Inventory</button>
            </div>
          ) : (
            cartItems.map(item => {
              const isOverLimit = item.orderQty > item.onHand;
              const isExternal = item.factoryId !== currentUser.factoryAffiliation;

              return (
                <div key={item.id} className={`bg-white rounded-xl border p-4 shadow-sm transition-all ${isOverLimit ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-medium text-gray-900 line-clamp-1" title={item.description}>{item.description}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500">{item.materialNumber}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isExternal ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-blue-50 text-blue-600 border border-blue-100'}`}>
                          {item.factoryId}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => onRemoveItem(item.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-gray-300 rounded-lg bg-white overflow-hidden">
                        <button
                          onClick={() => onUpdateQty(item.id, Math.max(1, item.orderQty - 1))}
                          className="px-3 py-1 hover:bg-gray-100 text-gray-600"
                        >-</button>
                        <input
                          type="number"
                          className="w-12 text-center text-sm font-medium focus:outline-none"
                          value={item.orderQty}
                          onChange={(e) => onUpdateQty(item.id, parseInt(e.target.value) || 0)}
                        />
                        <button
                          onClick={() => onUpdateQty(item.id, item.orderQty + 1)}
                          className="px-3 py-1 hover:bg-gray-100 text-gray-600"
                        >+</button>
                      </div>
                      <span className="text-xs text-gray-500">Max: {item.onHand}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-gray-900">{formatCurrency(item.unitCost * item.orderQty)}</div>
                      <div className="text-[10px] text-gray-400">Unit: {formatCurrency(item.unitCost)}</div>
                    </div>
                  </div>

                  {isOverLimit && (
                    <div className="mt-2 flex items-center gap-2 text-red-600 text-xs font-medium animate-pulse">
                      <AlertCircle className="w-3 h-3" />
                      Quantity exceeds available stock!
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {cartItems.length > 0 && (
          <div className="p-6 border-t border-gray-100 bg-gray-50 space-y-4">
            <div className="flex justify-between items-center text-gray-900">
              <span className="font-medium">Total Value</span>
              <span className="text-xl font-bold">{formatCurrency(totalValue)}</span>
            </div>

            {hasErrors && (
              <div className="p-3 bg-red-100 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                Some requests exceed stock limits.
              </div>
            )}

            <button
              onClick={handleCheckout}
              disabled={submitting || hasErrors}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Submitting...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5" /> Submit Requests
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </>
  );
};