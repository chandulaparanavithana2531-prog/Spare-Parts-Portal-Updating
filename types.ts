export interface RawExcelRow {
  [key: string]: string | number | undefined;
}

export interface SparePart {
  id: string; // Composite key: FactoryId + MaterialNumber
  factoryId: string;
  materialNumber: string;
  partNumber: string;
  description: string;
  qtyMoreThan3Years: number;
  valueMoreThan3Years: number;
  onHand: number;
  unitCost: number;
  totalValue: number;
  spareType: string;
  categoryName: string;
  machine: string;
  imageUrl?: string;
  image_url?: string;
  criticality?: string;
  consumptionQty?: number;
  consumptionValue?: number;
}

export interface CartItem extends SparePart {
  orderQty: number;
}

export interface FactorySummary {
  id: string;
  name: string;
  totalItems: number;
  totalValue: number;
  skuCount: number;
}

export enum SortField {
  MATERIAL_NUMBER = 'materialNumber',
  PART_NUMBER = 'partNumber',
  DESCRIPTION = 'description',
  MACHINE = 'machine',
  TOTAL_VALUE = 'totalValue',
  ON_HAND = 'onHand',
  FACTORY = 'factoryId',
  SPARE_TYPE = 'spareType',
  CATEGORY = 'categoryName',
  CRITICALITY = 'criticality'
}

export enum SortDirection {
  ASC = 'asc',
  DESC = 'desc'
}

// --- Auth & Orders ---

export type UserRole = 'admin' | 'user';

export interface User {
  username: string;
  role: UserRole;
  factoryAffiliation?: string; // If a user belongs to a specific factory
  approved: boolean;
}

export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'delivered';

export interface OrderItem {
  sparePartId: string;
  sparePartDescription: string;
  partNumber: string; // Snapshot
  machine: string; // Snapshot
  fromFactory: string;
  quantity: number;
  unitCost: number;
  totalValue: number;
  status: OrderStatus;
}

export interface Order {
  id: string;
  items: OrderItem[];
  totalValue: number; // Sum of all items
  requestedBy: string; // username
  status: OrderStatus;
  createdAt: number;
  approvedAt?: number;
}

// --- Audit Logs ---

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'UPLOAD' | 'ORDER_PROCESS' | 'USER_APPROVE' | 'CLEAR_DATABASE' | 'REQUEST_UPDATE';

export interface AuditLog {
  id: string;
  timestamp: number;
  userId: string;
  action: AuditAction;
  entityType: 'inventory' | 'order' | 'user' | 'audit_logs' | 'historical_consumption';
  entityId: string;
  details: string;
}

export interface HistoricalConsumptionRecord {
  id: string; // factoryId-year
  factoryId: string;
  year: number;
  consumptionQty: number;
  consumptionValue: number;
  uploadedBy: string;
  timestamp: number;
}

export interface UploadHistoryRecord {
  id: string;
  timestamp: number;
  uploadedBy: string;
  fileName: string;
  factoryId: string;
  system?: string;
  reportType: string;
  previousState: {
    [partId: string]: {
      onHand: number;
      totalValue: number;
      consumptionQty?: number;
      consumptionValue?: number;
      isNew?: boolean;
    }
  };
  updatedState: {
    [partId: string]: {
      onHand: number;
      totalValue: number;
      consumptionQty?: number;
      consumptionValue?: number;
    }
  };
}