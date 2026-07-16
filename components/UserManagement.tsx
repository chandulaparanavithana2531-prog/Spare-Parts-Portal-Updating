import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { getAllUsers, approveUser, deleteUser } from '../services/db';
import { CheckCircle, User as UserIcon, Building2, Trash2 } from 'lucide-react';

interface UserManagementProps {
    currentUser: User;
}

export const UserManagement: React.FC<UserManagementProps> = ({ currentUser }) => {
    const [users, setUsers] = useState<User[]>([]);
    const [filter, setFilter] = useState<'pending' | 'active'>('pending');
    const [loading, setLoading] = useState(true);
    const [approvingFactors, setApprovingFactors] = useState<Record<string, string>>({});

    const FACTORIES = [
        'Lanka Tiles',
        'Lanka Wall Tiles',
        'Rocell Horana',
        'Rocell Eheliyagoda'
    ];

    const fetchUsers = async () => {
        setLoading(true);
        const data = await getAllUsers();
        setUsers(data);
        setLoading(false);
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleApprove = async (username: string) => {
        const factory = approvingFactors[username];
        if (confirm(`Approve access for ${username}?${factory ? `\nAssigned Factory: ${factory}` : ''}`)) {
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

    const filteredUsers = users.filter(u =>
        filter === 'pending' ? !u.approved : u.approved
    );

    if (loading) return <div className="p-8 text-center text-gray-500">Loading users...</div>;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-4 rounded-xl border border-gray-100 shadow-sm gap-4">
                <h2 className="text-lg font-bold text-gray-900">User Management</h2>

                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => setFilter('pending')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'pending' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        Pending ({users.filter(u => !u.approved).length})
                    </button>
                    <button
                        onClick={() => setFilter('active')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'active' ? 'bg-white shadow text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        Active ({users.filter(u => u.approved).length})
                    </button>
                </div>
            </div>

            {filteredUsers.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-xl border border-gray-100 text-gray-500">
                    No {filter} users found.
                </div>
            ) : (
                <div className="grid gap-4">
                    {filteredUsers.map((user) => (
                        <div key={user.username} className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-full ${user.approved ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>
                                    <UserIcon className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900">{user.username}</h3>
                                    <div className="flex flex-col gap-2 mt-1">
                                        <div className="flex items-center gap-2 text-sm text-gray-500">
                                            <Building2 className="w-4 h-4" />
                                            {filter === 'active' ? (
                                                <span>{user.factoryAffiliation}</span>
                                            ) : (
                                                <select
                                                    value={approvingFactors[user.username] || user.factoryAffiliation || FACTORIES[0]}
                                                    onChange={(e) => setApprovingFactors(prev => ({ ...prev, [user.username]: e.target.value }))}
                                                    className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
                                                >
                                                    {FACTORIES.map(f => <option key={f} value={f}>{f}</option>)}
                                                </select>
                                            )}
                                            {user.role === 'admin' && <span className="text-blue-600 font-bold ml-2">(Admin)</span>}
                                        </div>
                                        {!user.approved && !user.factoryAffiliation && (
                                            <p className="text-[10px] text-amber-600 font-bold uppercase">* Confirm plant assignment</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                {!user.approved && (
                                    <button
                                        onClick={() => handleApprove(user.username)}
                                        className="flex-1 sm:flex-none px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 font-medium"
                                    >
                                        <CheckCircle className="w-4 h-4" />
                                        Approve
                                    </button>
                                )}

                                {/* Don't allow deleting yourself if active, but allow rejecting pending registrations */}
                                {(filter === 'pending' || user.username !== currentUser.username) && (
                                    <button
                                        onClick={() => handleDelete(user.username)}
                                        className="flex-1 sm:flex-none px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors flex items-center justify-center gap-2 font-medium"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        {filter === 'pending' ? 'Reject' : 'Delete'}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
