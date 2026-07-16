import React, { useState, useRef } from 'react';
import { SparePart, User } from '../types';
import { X, MapPin, Package, Settings, DollarSign, Calendar, Tag, Factory, Upload, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { saveInventory } from '../services/db';
import { storage } from '../services/firebase';
import { ref, uploadBytes, getDownloadURL, uploadString } from 'firebase/storage';

interface ItemDetailsModalProps {
    part: SparePart | null;
    reservedQuantity?: number;
    isOpen: boolean;
    onClose: () => void;
    onAddToCart: (part: SparePart) => void;
    currentUser: User;
    onSuccess?: () => void; // Callback for successful update
}

// --- Image Compression Helper (Reused) ---
const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        // Set a timeout to prevent infinite hanging
        const timeoutId = setTimeout(() => {
            reject(new Error("Image compression timed out (10s)"));
        }, 10000);

        const reader = new FileReader();

        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 1024;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_SIZE) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    clearTimeout(timeoutId); // Clear timeout on success
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas to Blob failed'));
                }, 'image/jpeg', 0.7);
            };

            img.onerror = (err) => {
                clearTimeout(timeoutId);
                reject(new Error("Image loading failed"));
            };

            // Set verify src AFTER setting handlers
            img.src = event.target?.result as string;
        };

        reader.onerror = (err) => {
            clearTimeout(timeoutId);
            reject(new Error("File reading failed"));
        };

        // Read file AFTER setting handlers
        reader.readAsDataURL(file);
    });
};

export const ItemDetailsModal: React.FC<ItemDetailsModalProps> = ({ part, reservedQuantity = 0, isOpen, onClose, onAddToCart, currentUser, onSuccess }) => {
    const [uploadStatus, setUploadStatus] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [imageLinkInput, setImageLinkInput] = useState('');
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    const imageUrls = React.useMemo(() => {
        if (!part?.imageUrl) return [];
        // Extract all URLs starting with https
        const urlMatches = part.imageUrl.match(/https:\/\/[^\s,]+/g);
        if (urlMatches && urlMatches.length > 0) return urlMatches;
        return [part.imageUrl];
    }, [part?.imageUrl]);


    if (!isOpen || !part) return null;

    // Reset state when modal opens/closes or part changes
    React.useEffect(() => {
        if (isOpen) {
            setUploadStatus(null);
            setErrorMsg(null);
            setShowLinkInput(false);
            setImageLinkInput('');
            setCurrentImageIndex(0);
        }
    }, [isOpen, part?.id]);

    const getDirectDriveLink = (url: string): string | null => {
        // Extract ID from: 
        // https://drive.google.com/file/d/1234567890abcdef/view
        // https://drive.google.com/open?id=1234567890abcdef

        let id = '';
        const parts = url.split('/');

        // Case 1: /file/d/ID/view
        const dIndex = parts.indexOf('d');
        if (dIndex !== -1 && parts.length > dIndex + 1) {
            id = parts[dIndex + 1];
        } else {
            // Case 2: id=ID param
            const match = url.match(/[?&]id=([^&]+)/);
            if (match) {
                id = match[1];
            }
        }

        if (!id) return null;

        // Construct direct view URL
        // Using the thumbnail API (sz=w1000) is often more reliable for public images than uc?export=view
        return `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
    };

    const handleLinkSave = async () => {
        if (!imageLinkInput.trim()) return;

        // Support multiple links separated by space or comma
        const links = imageLinkInput.match(/https:\/\/[^\s,]+/g);
        if (!links || links.length === 0) {
            setErrorMsg("No valid https links found.");
            return;
        }

        const directLinks = links.map(link => {
            const dl = getDirectDriveLink(link);
            return dl || link;
        });

        const finalUrlString = directLinks.join(' ');

        try {
            setUploadStatus('Saving...');

            const updatedPart = { ...part, imageUrl: finalUrlString };
            await saveInventory([updatedPart], currentUser.username);

            if (onSuccess) onSuccess();
            setShowLinkInput(false);
            setImageLinkInput('');
        } catch (error: any) {
            console.error("Update failed:", error);
            setErrorMsg(`Update failed: ${error.message}`);
        } finally {
            setUploadStatus(null);
        }
    };

    const formatCurrency = (val: number) => {
        return `Rs. ${new Intl.NumberFormat('en-LK', { maximumFractionDigits: 2 }).format(val)}`;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex items-start justify-between bg-gray-50">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 text-xs font-bold bg-blue-100 text-blue-700 rounded uppercase tracking-wide">
                                {part.spareType}
                            </span>
                            <span className="text-xs text-gray-500 font-mono">{part.id}</span>
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 leading-tight">{part.description}</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* content */}
                <div className="p-6 overflow-y-auto space-y-6">

                    {/* Image Banner (if exists) */}
                    {imageUrls.length > 0 ? (
                        <div className="w-full h-64 bg-gray-100 rounded-xl overflow-hidden border border-gray-200 flex items-center justify-center relative group">
                            {imageUrls.length > 1 && (
                                <button
                                    className="absolute left-2 z-10 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors opacity-0 group-hover:opacity-100"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : imageUrls.length - 1));
                                    }}
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>
                            )}

                            <img
                                src={imageUrls[currentImageIndex]}
                                alt={`${part.description} - Image ${currentImageIndex + 1}`}
                                className="w-full h-full object-contain transition-opacity duration-300"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                    e.currentTarget.onerror = null; // Prevent infinite loop
                                    e.currentTarget.src = 'https://placehold.co/600x400?text=Access+Denied+or+Invalid+Link';
                                }}
                            />

                            {imageUrls.length > 1 && (
                                <button
                                    className="absolute right-2 z-10 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors opacity-0 group-hover:opacity-100"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setCurrentImageIndex((prev) => (prev < imageUrls.length - 1 ? prev + 1 : 0));
                                    }}
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            )}

                            {/* Image indicators */}
                            {imageUrls.length > 1 && (
                                <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                                    {imageUrls.map((_, idx) => (
                                        <div
                                            key={idx}
                                            className={`w-2 h-2 rounded-full transition-colors ${idx === currentImageIndex ? 'bg-white' : 'bg-white/50'}`}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* Allow re-uploading even if image exists */}
                            <div
                                className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <span
                                    className="text-white font-medium flex items-center gap-2 cursor-pointer mb-3 px-3 py-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
                                    onClick={(e) => { e.stopPropagation(); setShowLinkInput(true); }}
                                >
                                    <Upload className="w-4 h-4" /> Change Image Link(s)
                                </span>

                                <a
                                    href={imageUrls[currentImageIndex].includes('lh3.googleusercontent.com/d/')
                                        ? `https://drive.google.com/file/d/${imageUrls[currentImageIndex].split('/d/')[1]}/view`
                                        : imageUrls[currentImageIndex]}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-white font-medium flex items-center gap-2 px-3 py-2 bg-blue-600/80 rounded-full hover:bg-blue-600 transition-colors text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <Settings className="w-3 h-3" /> Open in Drive
                                </a>
                            </div>
                        </div>
                    ) : (
                        !showLinkInput ? (
                            <div
                                className={`w-full h-48 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer group`}
                                onClick={() => setShowLinkInput(true)}
                            >
                                <div className="p-3 bg-white rounded-full shadow-sm mb-2 group-hover:scale-110 transition-transform">
                                    <Upload className="w-6 h-6" />
                                </div>
                                <span className="font-medium text-sm">No image available</span>
                                <span className="text-xs mt-1">Click to add Google Drive Link</span>
                            </div>
                        ) : null
                    )}

                    {/* Google Drive Link Input */}
                    {showLinkInput && (
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 animate-in fade-in zoom-in-95 duration-200">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-blue-700 uppercase">Google Drive Image Link</label>
                                <button onClick={() => setShowLinkInput(false)} className="text-gray-400 hover:text-gray-600">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={imageLinkInput}
                                    onChange={(e) => setImageLinkInput(e.target.value)}
                                    placeholder="Paste Drive Link (e.g., https://drive.google.com/file/d/...)"
                                    className="flex-1 px-3 py-2 rounded-lg border border-blue-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                                <button
                                    onClick={handleLinkSave}
                                    disabled={!imageLinkInput.trim() || !!uploadStatus}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm whitespace-nowrap"
                                >
                                    {uploadStatus === 'Saving...' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Link'}
                                </button>
                            </div>
                            <p className="text-xs text-blue-600/70 mt-2">
                                * Ensure the image on Drive is set to "Anyone with the link" so it can be viewed.
                            </p>
                        </div>
                    )}

                    {/* Error Display */}
                    <div className="flex flex-col gap-2">
                        {errorMsg && (
                            <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">
                                {errorMsg}
                            </div>
                        )}
                    </div>



                    {/* Main Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 flex flex-col justify-center">
                            <div className="text-xs text-blue-600 font-bold uppercase tracking-wider mb-1">Stock</div>
                            <div className="text-3xl font-bold text-gray-900 leading-none">
                                {part.onHand}
                            </div>
                            {reservedQuantity > 0 && (
                                <div className="text-xs font-semibold text-orange-600 mt-1">
                                    {reservedQuantity} Reserved
                                </div>
                            )}
                        </div>
                        <div className="p-4 bg-green-50 rounded-xl border border-green-100 flex flex-col justify-center">
                            <div className="text-xs text-green-600 font-bold uppercase tracking-wider mb-1">Unit Cost</div>
                            <div className="flex flex-col">
                                <span className="text-xs font-semibold text-green-600/70 mb-0.5">LKR</span>
                                <div className="text-xl font-bold text-gray-900 leading-tight">
                                    {new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(part.unitCost)}
                                </div>
                            </div>
                        </div>
                        <div className="p-4 bg-purple-50 rounded-xl border border-purple-100 col-span-2 md:col-span-1 flex flex-col justify-center">
                            <div className="text-xs text-purple-600 font-bold uppercase tracking-wider mb-1">Total Value</div>
                            <div className="flex flex-col">
                                <span className="text-xs font-semibold text-purple-600/70 mb-0.5">LKR</span>
                                <div className="text-xl font-bold text-gray-900 leading-tight">
                                    {new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(part.totalValue)}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Details Section */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-gray-900 flex items-center gap-2 border-b pb-2">
                            <Package className="w-4 h-4 text-gray-500" />
                            Product Details
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 text-sm">

                            <div className="space-y-1">
                                <div className="text-gray-500 text-xs uppercase">Item Code</div>
                                <div className="font-medium font-mono text-gray-900">{part.materialNumber}</div>
                            </div>

                            <div className="space-y-1">
                                <div className="text-gray-500 text-xs uppercase">Part Number</div>
                                <div className="font-medium font-mono text-gray-900">{part.partNumber}</div>
                            </div>

                            <div className="space-y-1">
                                <div className="text-gray-500 text-xs uppercase">Category</div>
                                <div className="font-medium text-gray-900 flex items-center gap-1">
                                    <Tag className="w-3 h-3 text-gray-400" /> {part.categoryName}
                                </div>
                            </div>

                            <div className="space-y-1">
                                <div className="text-gray-500 text-xs uppercase">Location</div>
                                <div className="font-medium text-gray-900 flex items-center gap-1">
                                    <Factory className="w-3 h-3 text-gray-400" /> {part.factoryId}
                                </div>
                            </div>

                            <div className="space-y-1">
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
                                        <div className={`font-black text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full w-fit ${badgeClass}`}>
                                            {label}
                                        </div>
                                    );
                                })()}
                            </div>

                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="font-bold text-gray-900 flex items-center gap-2 border-b pb-2">
                            <Settings className="w-4 h-4 text-gray-500" />
                            Usage Info
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 text-sm">

                            <div className="space-y-1">
                                <div className="text-gray-500 text-xs uppercase">Machine</div>
                                <div className="font-medium text-gray-900">{part.machine}</div>
                            </div>

                            <div className="space-y-1">
                                <div className="text-gray-500 text-xs uppercase">Dead Stock (3+ Years)</div>
                                <div className="font-medium text-gray-900">
                                    {part.qtyMoreThan3Years} units
                                    <span className="text-gray-400 mx-1">|</span>
                                    {formatCurrency(part.valueMoreThan3Years)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors font-medium"
                    >
                        Close
                    </button>
                    {currentUser.role !== 'admin' && (
                        <button
                            onClick={() => { onAddToCart(part); onClose(); }}
                            className="px-6 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors font-medium shadow-lg shadow-blue-200"
                        >
                            Add to Cart
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
};
