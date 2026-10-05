import React, { useEffect, useState } from 'react';
import { User, UserRole } from '../types';
import { getAllUsers, approveUser, deleteUser, adminAddUser, updateUserEmail, STANDARD_PLANT_ACCOUNTS } from '../services/db';
import {
  CheckCircle, User as UserIcon, Building2, Trash2, Plus, X, ShieldCheck,
  Eye, EyeOff, Mail, Lock, AlertCircle, RefreshCw, Edit3, KeyRound, Info
} from 'lucide-react';

interface UserManagementProps {
  currentUser: User;
}

const PLANTS = [
  'ALL',
  'Lanka Tiles',
  'Lanka Wall Tiles',
  'Rocell Horana',
  'Rocell Eheliyagoda',
];

const PLANT_SHORT: Record<string, string> = {
  'ALL': 'ALL',
  'Lanka Tiles': 'LT',
  'Lanka Wall Tiles': 'LWT',
  'Rocell Horana': 'RCLH',
  'Rocell Eheliyagoda': 'RCLE',
};

const PLANT_COLORS: Record<string, string> = {
  'ALL': 'bg-gray-100 text-gray-700',
  'Lanka Tiles': 'bg-blue-100 text-blue-700',
  'Lanka Wall Tiles': 'bg-emerald-100 text-emerald-700',
  'Rocell Horana': 'bg-amber-100 text-amber-700',
  'Rocell Eheliyagoda': 'bg-purple-100 text-purple-700',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-indigo-100 text-indigo-700',
  user: 'bg-green-100 text-green-700',
};

interface EditUserModalProps {
  user: User;
  onClose: () => void;
  onSaveSuccess: () => void;
  currentUser: User;
}

const EditUserModal: React.FC<EditUserModalProps> = ({ user, onClose, onSaveSuccess, currentUser }) => {
  const [email, setEmail] = useState(user.email || user.username);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;
    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address (e.g. plant.manager@company.com).');
      return;
    }
    if (password && password.length < 4) {
      setError('Password must be at least 4 characters long.');
      return;
    }

    setLoading(true);
    try {
      await updateUserEmail(user.username, email.trim(), password ? password.trim() : undefined, currentUser.username);
      setSuccess(`Email updated successfully for ${user.username}!`);
      setTimeout(() => {
        onSaveSuccess();
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Failed to update user email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-md shadow-blue-200">
            <Edit3 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Edit Account Email</h3>
            <p className="text-xs text-gray-500 font-medium">
              Update plant user email for <span className="font-bold text-gray-700">{user.username}</span>
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
              Account Role & Plant
            </label>
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100">
              <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${PLANT_COLORS[user.factoryAffiliation || 'ALL'] || 'bg-gray-100 text-gray-700'}`}>
                {PLANT_SHORT[user.factoryAffiliation || 'ALL'] || user.factoryAffiliation || 'ALL'}
              </span>
              <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${ROLE_COLORS[user.role]}`}>
                {user.role === 'admin' ? 'Admin' : 'Plant User'}
              </span>
              <span className="text-xs font-bold text-gray-700 truncate">{user.username}</span>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
              User Email Address *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="h-4 w-4 text-gray-400" />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="plant.user@company.com"
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1 font-medium">
              Orders created for this plant will send notifications to this email.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
              New Password <span className="text-gray-300 font-normal">(Leave blank to keep unchanged)</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-gray-400" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter new password (optional)"
                className="w-full pl-9 pr-10 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-2 bg-green-50 border border-green-100 text-green-700 rounded-xl p-3 text-xs font-semibold">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-md shadow-blue-100 transition-all cursor-pointer disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Save Email
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const UserManagement: React.FC<UserManagementProps> = ({ currentUser }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [actionSuccess, setActionSuccess] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    const data = await getAllUsers();
    setUsers(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDelete = async (username: string) => {
    if (confirm(`Are you sure you want to delete user ${username}?`)) {
      await deleteUser(username, currentUser.username);
      await fetchUsers();
    }
  };

  // Group accounts into 1 Admin Account and 4 Plant User Accounts
  const adminAccount = users.find(u => u.role === 'admin') || {
    username: 'admin',
    email: 'sparevone@gmail.com',
    role: 'admin' as UserRole,
    approved: true
  };

  const plantAccounts = [
    'Lanka Tiles',
    'Lanka Wall Tiles',
    'Rocell Horana',
    'Rocell Eheliyagoda'
  ].map(plantName => {
    const existing = users.find(u => u.factoryAffiliation === plantName || u.username === plantName);
    if (existing) return existing;
    const std = STANDARD_PLANT_ACCOUNTS.find(s => s.factoryAffiliation === plantName);
    return {
      username: plantName,
      email: std?.email || 'plant@rcl.lk',
      role: 'user' as UserRole,
      factoryAffiliation: plantName,
      approved: true
    };
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-300 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-400/30">
                1 Admin & 4 Plant Accounts System
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Plant User Account Management
            </h2>
            <p className="text-xs text-slate-300 max-w-xl mt-1 leading-relaxed">
              The portal is configured with <strong className="text-white">1 Admin account</strong> and <strong className="text-white">4 User accounts for the 4 plants</strong>.
              As Admin, you can edit each plant's user email address and login credentials below.
            </p>
          </div>
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold backdrop-blur-md transition-all cursor-pointer disabled:opacity-50 shrink-0 border border-white/10"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Accounts
          </button>
        </div>
      </div>

      {actionSuccess && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-100 text-green-700 rounded-2xl p-4 text-xs font-bold animate-in fade-in duration-200">
          <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Grid of Accounts: 1 Admin Account + 4 Plant User Accounts */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-400">
            System Accounts Overview (1 Admin + 4 Plants)
          </h3>
          <span className="text-[10px] font-bold text-gray-400">
            5 Configured Accounts
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-400 text-xs font-bold">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-500" />
            Loading portal user accounts...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* 1. Admin Account Card */}
            <div className="bg-gradient-to-br from-indigo-50/80 to-slate-50 rounded-2xl p-5 border border-indigo-100 shadow-xs hover:shadow-md transition-all flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-indigo-600 text-white">
                    Admin Account
                  </span>
                  <ShieldCheck className="w-5 h-5 text-indigo-600" />
                </div>
                <h4 className="text-sm font-bold text-gray-900 truncate">System Administrator</h4>
                <p className="text-[11px] text-gray-500 font-medium">Username: <span className="font-bold text-gray-700">{adminAccount.username}</span></p>

                <div className="mt-4 p-3 bg-white/80 rounded-xl border border-indigo-100/60 space-y-1">
                  <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Admin Email</span>
                  <p className="text-xs font-bold text-gray-800 truncate flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    {adminAccount.email || 'sparevone@gmail.com'}
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-indigo-100/50 flex items-center justify-between">
                <span className="text-[10px] text-indigo-600 font-bold bg-indigo-100/60 px-2 py-0.5 rounded-md">
                  Full System Control
                </span>
                <button
                  onClick={() => setEditingUser(adminAccount)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Edit Admin Email
                </button>
              </div>
            </div>

            {/* 2. Four Plant User Accounts */}
            {plantAccounts.map((plantUser) => {
              const plantName = plantUser.factoryAffiliation || plantUser.username;
              const shortCode = PLANT_SHORT[plantName] || plantName;
              const plantColor = PLANT_COLORS[plantName] || 'bg-gray-100 text-gray-700';

              return (
                <div
                  key={plantName}
                  className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs hover:shadow-md hover:border-blue-100 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${plantColor}`}>
                        {shortCode} Plant Account
                      </span>
                      <Building2 className="w-5 h-5 text-gray-400" />
                    </div>

                    <h4 className="text-sm font-bold text-gray-900 truncate">{plantName}</h4>
                    <p className="text-[11px] text-gray-500 font-medium">
                      Assigned Plant: <span className="font-bold text-gray-700">{plantName}</span>
                    </p>

                    <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-1">
                      <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Plant Email Address</span>
                      <p className="text-xs font-bold text-gray-800 truncate flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        {plantUser.email || `${shortCode.toLowerCase()}@rcl.lk`}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[10px] text-green-700 font-bold bg-green-50 px-2 py-0.5 rounded-md border border-green-100">
                      Active Plant User
                    </span>
                    <button
                      onClick={() => setEditingUser(plantUser)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit Plant Email
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info Callout */}
      <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-5 text-xs text-blue-800 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="font-bold text-blue-900">How Plant User Emails Work:</h4>
          <p className="text-blue-700 leading-relaxed font-medium">
            When an order is created for a specific plant (Lanka Tiles, Lanka Wall Tiles, Rocell Horana, or Rocell Eheliyagoda),
            the portal automatically routes order requisition notification emails to the edited plant user email address above.
            Plant users can sign in using either their plant name or their updated email address.
          </p>
        </div>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          currentUser={currentUser}
          onClose={() => setEditingUser(null)}
          onSaveSuccess={() => {
            setActionSuccess(`Email address for ${editingUser.username} updated successfully!`);
            fetchUsers();
            setTimeout(() => setActionSuccess(''), 4000);
          }}
        />
      )}
    </div>
  );
};
