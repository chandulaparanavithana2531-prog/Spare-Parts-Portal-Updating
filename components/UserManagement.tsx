import React, { useEffect, useState } from 'react';
import { User, UserRole } from '../types';
import { getAllUsers, approveUser, deleteUser, adminAddUser } from '../services/db';
import {
  CheckCircle, User as UserIcon, Building2, Trash2, Plus, X, ShieldCheck,
  Eye, EyeOff, Mail, Lock, AlertCircle, RefreshCw
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

interface NewUserForm {
  email: string;
  plant: string;
  role: UserRole;
  password: string;
}

const emptyForm = (): NewUserForm => ({
  email: '',
  plant: PLANTS[1],
  role: 'user',
  password: '',
});

export const UserManagement: React.FC<UserManagementProps> = ({ currentUser }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active'>('active');
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<NewUserForm>(emptyForm());
  const [showPassword, setShowPassword] = useState(false);
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addSuccess, setAddSuccess] = useState('');
  const [approvingFactors, setApprovingFactors] = useState<Record<string, string>>({});

  const fetchUsers = async () => {
    setLoading(true);
    const data = await getAllUsers();
    setUsers(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;
    if (!emailRegex.test(form.email)) {
      setAddError('Please enter a valid email address (e.g. user@company.com).');
      return;
    }
    if (form.password.length < 4) {
      setAddError('Password must be at least 4 characters.');
      return;
    }

    setAddLoading(true);
    try {
      const newUser: User = {
        username: form.email.toLowerCase().trim(),
        email: form.email.toLowerCase().trim(),
        role: form.role,
        factoryAffiliation: form.plant === 'ALL' ? undefined : form.plant,
        approved: true,
      };
      await adminAddUser(newUser, form.password, currentUser.username);
      setAddSuccess(`User ${form.email} has been created and granted access successfully.`);
      setForm(emptyForm());
      await fetchUsers();
      // Auto-hide success after 4 seconds
      setTimeout(() => setAddSuccess(''), 4000);
    } catch (err: any) {
      setAddError(err.message || 'Failed to create user. Please try again.');
    } finally {
      setAddLoading(false);
    }
  };

  const handleApprove = async (username: string) => {
    const factory = approvingFactors[username];
    if (confirm(`Approve access for ${username}?${factory ? `\nAssigned Plant: ${factory}` : ''}`)) {
      await approveUser(username, currentUser.username, factory);
      await fetchUsers();
    }
  };

  const handleDelete = async (username: string) => {
    if (confirm(`Are you sure you want to delete user ${username}? This action cannot be undone.`)) {
      await deleteUser(username, currentUser.username);
      await fetchUsers();
    }
  };

  const filteredUsers = users.filter(u => {
    if (filter === 'pending') return !u.approved;
    if (filter === 'active') return u.approved;
    return true;
  });

  const pendingCount = users.filter(u => !u.approved).length;
  const activeCount = users.filter(u => u.approved).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">User Access Management</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Grant and manage portal access. Only admin-created accounts can log in.
          </p>
        </div>
        <button
          onClick={() => { setShowAddForm(v => !v); setAddError(''); setAddSuccess(''); }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-200 cursor-pointer shrink-0 ${
            showAddForm
              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-100'
          }`}
        >
          {showAddForm ? <><X className="w-4 h-4" /> Cancel</> : <><Plus className="w-4 h-4" /> Grant Access</>}
        </button>
      </div>

      {/* Add User Form — Admin grants access */}
      {showAddForm && (
        <div className="bg-gradient-to-br from-blue-50/80 to-indigo-50/60 border border-blue-100 rounded-2xl p-6 animate-in fade-in slide-in-from-top-2 duration-200 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-200">
              <UserIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Grant Portal Access</h3>
              <p className="text-[11px] text-gray-500">Create a user account and assign their plant & role</p>
            </div>
          </div>

          <form onSubmit={handleAddUser}>
            {/* Spreadsheet-style Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {/* Email */}
              <div className="lg:col-span-2 space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    required
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="user@company.com"
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              {/* Plant */}
              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Plant
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Building2 className="h-4 w-4 text-gray-400" />
                  </div>
                  <select
                    value={form.plant}
                    onChange={e => setForm(f => ({ ...f, plant: e.target.value }))}
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all appearance-none cursor-pointer"
                  >
                    {PLANTS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Role */}
              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Role
                </label>
                <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, role: 'user' }))}
                    className={`flex-1 py-2.5 text-xs font-bold transition-all cursor-pointer ${
                      form.role === 'user'
                        ? 'bg-green-600 text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    Plant
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, role: 'admin' }))}
                    className={`flex-1 py-2.5 text-xs font-bold transition-all cursor-pointer border-l border-gray-200 ${
                      form.role === 'admin'
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    Admin
                  </button>
                </div>
              </div>
            </div>

            {/* Password Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Initial Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Set a password for this user"
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

              {/* Preview badge */}
              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Access Preview
                </label>
                <div className="flex items-center gap-2 h-[42px] px-3 bg-white border border-gray-200 rounded-xl">
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${PLANT_COLORS[form.plant] || 'bg-gray-100 text-gray-700'}`}>
                    {PLANT_SHORT[form.plant] || form.plant}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${ROLE_COLORS[form.role]}`}>
                    {form.role === 'admin' ? 'Admin' : 'Plant User'}
                  </span>
                  {form.email && (
                    <span className="text-[10px] text-gray-400 truncate font-medium">{form.email}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Errors / Success */}
            {addError && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 mb-4 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-xs font-semibold">{addError}</p>
              </div>
            )}
            {addSuccess && (
              <div className="flex items-start gap-2.5 bg-green-50 border border-green-100 text-green-700 rounded-xl px-4 py-3 mb-4 animate-in fade-in duration-200">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-xs font-semibold">{addSuccess}</p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={addLoading}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-md shadow-blue-100 transition-all cursor-pointer"
              >
                {addLoading ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Creating...</>
                ) : (
                  <><ShieldCheck className="w-4 h-4" /> Grant Access</>
                )}
              </button>
              <p className="text-[10px] text-gray-400">
                User will be able to log in immediately with this email and password.
              </p>
            </div>
          </form>
        </div>
      )}

      {/* Filter Tabs + Refresh */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-4 rounded-xl border border-gray-100 shadow-sm gap-4">
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setFilter('active')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'active' ? 'bg-white shadow text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Active ({activeCount})
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'pending' ? 'bg-white shadow text-orange-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Pending ({pendingCount})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'all' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            All ({users.length})
          </button>
        </div>
        <button
          onClick={fetchUsers}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-blue-600 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* User Table */}
      {loading ? (
        <div className="p-8 text-center text-gray-500">Loading users...</div>
      ) : filteredUsers.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100 text-gray-500">
          No {filter === 'all' ? '' : filter} users found.
        </div>
      ) : (
        <>
          {/* Table Header */}
          <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <div className="col-span-4">Email / Username</div>
            <div className="col-span-2">Plant</div>
            <div className="col-span-2">Role</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          <div className="space-y-2">
            {filteredUsers.map((user) => (
              <div
                key={user.username}
                className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all duration-200"
              >
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center px-5 py-4">
                  {/* Email */}
                  <div className="col-span-4 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm uppercase shrink-0 ${user.approved ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                      {user.username.substring(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">{user.username}</p>
                      <p className="text-[10px] text-gray-400 font-medium">
                        {user.email && user.email !== user.username ? user.email : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Plant */}
                  <div className="col-span-2">
                    {!user.approved ? (
                      <select
                        value={approvingFactors[user.username] || user.factoryAffiliation || PLANTS[1]}
                        onChange={e => setApprovingFactors(prev => ({ ...prev, [user.username]: e.target.value }))}
                        className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-blue-500 w-full"
                      >
                        {PLANTS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold ${PLANT_COLORS[user.factoryAffiliation || 'ALL'] || 'bg-gray-100 text-gray-700'}`}>
                        {PLANT_SHORT[user.factoryAffiliation || 'ALL'] || user.factoryAffiliation || 'ALL'}
                      </span>
                    )}
                  </div>

                  {/* Role */}
                  <div className="col-span-2">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-700'}`}>
                      {user.role === 'admin' ? (
                        <><ShieldCheck className="w-3 h-3" /> Admin</>
                      ) : (
                        'Plant User'
                      )}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="col-span-2">
                    {user.approved ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-green-50 text-green-700 border border-green-100">
                        <CheckCircle className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-100">
                        Pending
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="col-span-2 flex items-center justify-end gap-2">
                    {!user.approved && (
                      <button
                        onClick={() => handleApprove(user.username)}
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Approve
                      </button>
                    )}
                    {(filter === 'pending' || user.username !== currentUser.username) && (
                      <button
                        onClick={() => handleDelete(user.username)}
                        className="px-3 py-1.5 bg-white border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                        title="Delete user"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {filter === 'pending' ? 'Reject' : 'Delete'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Info note */}
      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 font-medium">
        <span className="font-bold">Note:</span> Only users created or approved here can sign in to the portal.
        The self-registration option has been disabled — access must be granted by an admin.
      </div>
    </div>
  );
};
