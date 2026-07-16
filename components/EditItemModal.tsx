import React, { useState, useRef, useEffect } from 'react';
import { SparePart, User } from '../types';
import { saveInventory } from '../services/db';
import { storage } from '../services/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { X, Save, Loader2, PackagePlus, Upload, Lock, AlertCircle } from 'lucide-react';

interface EditItemModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    part: SparePart | null;
    imageUploadOnly?: boolean;
    currentUser: User;
}

// --- Image Compression Helper ---
const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');

                // Resize logic: Max dimension 1024px
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

                // Compress to JPEG with 0.7 quality
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas to Blob failed'));
                }, 'image/jpeg', 0.7);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};

export const EditItemModal: React.FC<EditItemModalProps> = ({ isOpen, onClose, onSuccess, part, currentUser, imageUploadOnly = false }) => {
    const [loading, setLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [formData, setFormData] = useState({
        description: '',
        partNumber: '',
        machine: '',
        categoryName: '',
        spareType: '',
        criticality: '',
        onHand: 0,
        unitCost: 0
    });

    // Pre-fill form when part changes
    useEffect(() => {
        if (part) {
            setFormData({
                description: part.description,
                partNumber: part.partNumber,
                machine: part.machine,
                categoryName: part.categoryName,
                spareType: part.spareType,
                criticality: part.criticality || '',
                onHand: part.onHand,
                unitCost: part.unitCost
            });
            const urlMatches = part.imageUrl?.match(/https:\/\/[^\s,]+/g);
            setPreviewUrl(urlMatches && urlMatches.length > 0 ? urlMatches[0] : null);
            setSelectedFile(null); // Reset file selection
        }
    }, [part]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'onHand' || name === 'unitCost' ? parseFloat(value) : value
        }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            // Basic Size Check (5MB Limit Input)
            if (file.size > 5 * 1024 * 1024) {
                alert("File size must be less than 5MB");
                return;
            }

            setSelectedFile(file);
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!part) return;

        setLoading(true);

        try {
            const totalValue = (formData.onHand || 0) * (formData.unitCost || 0);
            let imageUrl = part.imageUrl || '';

            // --- Image Upload Logic ---
            if (selectedFile) {
                try {
                    // 1. Compress
                    const compressedBlob = await compressImage(selectedFile);

                    // 2. Upload (Overwrite existing if any, using part ID as filename for consistency)
                    const storageRef = ref(storage, `spare-parts/${part.id}.jpg`);
                    await uploadBytes(storageRef, compressedBlob);

                    // 3. Get URL
                    imageUrl = await getDownloadURL(storageRef);
                } catch (err) {
                    console.error("Image upload failed", err);
                    alert("Image upload failed, saving item without image update.");
                }
            }

            let updatedPart: SparePart;

            if (imageUploadOnly) {
                updatedPart = {
                    ...part,
                    imageUrl: imageUrl || undefined
                };
            } else {
                const totalValue = (formData.onHand || 0) * (formData.unitCost || 0);
                updatedPart = {
                    ...part,
                    ...formData,
                    onHand: Number(formData.onHand),
                    unitCost: Number(formData.unitCost),
                    totalValue: totalValue,
                    imageUrl: imageUrl || undefined
                };
            }

            // Reuse saveInventory logic which handles sets/overwrites
            await saveInventory([updatedPart], currentUser.username);
            onSuccess();
            onClose();
        } catch (error) {
            console.error(error);
            alert('Failed to update item.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || !part) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                    <div className="flex items-center gap-2 text-blue-700">
                        {imageUploadOnly ? <Upload className="w-5 h-5" /> : <PackagePlus className="w-5 h-5" />}
                        <div>
                            <h2 className="text-lg font-bold">{imageUploadOnly ? 'Upload Item Image' : 'Edit Spare Item'}</h2>
                            <div className="text-xs text-gray-500 font-mono">{part.id}</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-200 rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1">
                    {imageUploadOnly && (
                        <div className="mb-4 bg-blue-50 text-blue-700 text-sm p-3 rounded-lg flex items-center gap-2 border border-blue-100">
                            <Lock className="w-4 h-4" />
                            You can only update the image for this item. Other details are read-only.
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                        {/* Column 1: Identification & Image */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Identification</h3>

                            {/* Image Uploader */}
                            <div className="flex justify-center mb-4">
                                <div
                                    className="relative w-full h-40 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors overflow-hidden group"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    {previewUrl ? (
                                        <>
                                            <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <span className="text-white text-xs font-medium">Change Image</span>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="p-3 bg-white rounded-full shadow-sm mb-2">
                                                <Upload className="w-5 h-5 text-gray-400" />
                                            </div>
                                            <p className="text-xs text-gray-500 font-medium">Click to upload image</p>
                                            <p className="text-[10px] text-gray-400 mt-1">Max 5MB (Auto-compressed)</p>
                                        </>
                                    )}
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        accept="image/*"
                                        onChange={handleFileChange}
                                    />
                                </div>
                                {/* Remove Image Button? - Maybe safe not to allow removing for now, only replacing */}
                            </div>

                            {/* Read-Only Fields */}
                            {!imageUploadOnly && (
                                <div className="p-3 bg-gray-50 rounded border border-gray-200 text-sm text-gray-500 space-y-2">
                                    <div className="flex items-center gap-2 mb-2 text-amber-600 font-medium text-xs">
                                        <Lock className="w-3 h-3" />
                                        Fixed Identifiers
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <span className="block text-xs uppercase">Factory</span>
                                            <span className="font-mono text-gray-800">{part.factoryId}</span>
                                        </div>
                                        <div>
                                            <span className="block text-xs uppercase">Item Code</span>
                                            <span className="font-mono text-gray-800">{part.materialNumber}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {!imageUploadOnly && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Part Number</label>
                                    <input
                                        type="text"
                                        name="partNumber"
                                        value={formData.partNumber}
                                        onChange={handleChange}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Column 2: Details & Value - HIDDEN for imageUploadOnly */}
                        {!imageUploadOnly && (
                            <div className="space-y-4">
                                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Details</h3>

                                {/* Standard Inputs */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        name="description"
                                        value={formData.description}
                                        onChange={handleChange}
                                        required
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Machine</label>
                                        <input
                                            type="text"
                                            name="machine"
                                            value={formData.machine}
                                            onChange={handleChange}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                                        <input
                                            type="text"
                                            name="categoryName"
                                            value={formData.categoryName}
                                            onChange={handleChange}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Spare Type</label>
                                        <input
                                            type="text"
                                            name="spareType"
                                            value={formData.spareType}
                                            onChange={handleChange}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Criticality</label>
                                        <select
                                            name="criticality"
                                            value={formData.criticality}
                                            onChange={handleChange}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white"
                                        >
                                            <option value="">Select Criticality</option>
                                            <option value="Vital">Vital (V)</option>
                                            <option value="Essential">Essential (E)</option>
                                            <option value="Desirable">Desirable (D)</option>
                                            <option value="Non Using">Non Using</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 space-y-3 mt-4">
                                    <div>
                                        <label className="block text-sm font-medium text-blue-900 mb-1">Current Stock (Qty)</label>
                                        <input
                                            type="number"
                                            step="any"
                                            name="onHand"
                                            value={formData.onHand}
                                            onChange={handleChange}
                                            className="w-full border border-blue-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-blue-900 mb-1">Unit Cost (Rs)</label>
                                        <input
                                            type="number"
                                            step="any"
                                            name="unitCost"
                                            value={formData.unitCost}
                                            onChange={handleChange}
                                            className="w-full border border-blue-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        />
                                    </div>
                                    <div className="pt-2 flex justify-between items-center text-sm font-bold text-blue-800 border-t border-blue-200">
                                        <span>Total Value:</span>
                                        <span>Rs. {((formData.onHand || 0) * (formData.unitCost || 0)).toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="mt-8 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-md shadow-blue-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {imageUploadOnly ? 'Update Image' : 'Update Item'}
                        </button>
                    </div>
                </form>
            </div >
        </div >
    );
};
