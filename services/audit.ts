import { collection, addDoc, query, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from './firebase';
import { AuditLog, AuditAction } from '../types';

export const logAction = async (
    userId: string,
    action: AuditAction | string,
    entityType: string,
    entityId: string,
    details: string,
    extra?: {
      userName?: string;
      plantId?: string;
      plantName?: string;
      changes?: any;
    }
) => {
    try {
        const log: any = {
            timestamp: Date.now(),
            userId,
            action,
            entityType,
            entityId,
            details,
            user_id: userId,
            user_name: extra?.userName || userId,
            plant_id: extra?.plantId || 'System',
            plant_name: extra?.plantName || 'System',
            changes: extra?.changes ? JSON.stringify(extra.changes) : null,
            created_at: Date.now()
        };
        await addDoc(collection(db, 'audit_logs'), log);
    } catch (error) {
        console.error("Failed to log action:", error);
    }
};

export const getAuditLogs = async (count: number = 200): Promise<any[]> => {
    try {
        const q = query(
            collection(db, 'audit_logs'),
            orderBy('timestamp', 'desc'),
            limit(count)
        );
        const querySnapshot = await getDocs(q);
        const logs: any[] = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            logs.push({
                id: doc.id,
                timestamp: data.created_at || data.timestamp || Date.now(),
                created_at: data.created_at || data.timestamp || Date.now(),
                userId: data.user_id || data.userId || 'unknown',
                user_id: data.user_id || data.userId || 'unknown',
                user_name: data.user_name || data.userId || 'unknown',
                plant_id: data.plant_id || data.plantId || 'System',
                plant_name: data.plant_name || data.plantName || 'System',
                action: data.action,
                entityType: data.entity_type || data.entityType,
                entity_id: data.entity_id || data.entityId,
                entityId: data.entity_id || data.entityId,
                changes: data.changes || null,
                details: data.details || ''
            });
        });
        return logs;
    } catch (error) {
        console.error("Failed to fetch audit logs:", error);
        return [];
    }
};
