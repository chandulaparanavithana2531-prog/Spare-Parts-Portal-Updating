import { collection, addDoc, query, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from './firebase';
import { AuditLog, AuditAction } from '../types';

export const logAction = async (
    userId: string,
    action: AuditAction,
    entityType: AuditLog['entityType'],
    entityId: string,
    details: string
) => {
    try {
        const log: Omit<AuditLog, 'id'> = {
            timestamp: Date.now(),
            userId,
            action,
            entityType,
            entityId,
            details
        };
        await addDoc(collection(db, 'audit_logs'), log);
    } catch (error) {
        console.error("Failed to log action:", error);
    }
};

export const getAuditLogs = async (count: number = 100): Promise<AuditLog[]> => {
    try {
        const q = query(
            collection(db, 'audit_logs'),
            orderBy('timestamp', 'desc'),
            limit(count)
        );
        const querySnapshot = await getDocs(q);
        const logs: AuditLog[] = [];
        querySnapshot.forEach((doc) => {
            logs.push({ id: doc.id, ...doc.data() } as AuditLog);
        });
        return logs;
    } catch (error) {
        console.error("Failed to fetch audit logs:", error);
        return [];
    }
};
