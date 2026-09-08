import { collection, doc, writeBatch, getDocs, setDoc, getDoc, query, where, Timestamp, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import { SparePart, User, Order, OrderStatus, HistoricalConsumptionRecord, UploadHistoryRecord } from '../types';
import { logAction } from './audit';
import { resolvePlantId } from './inventorySyncService';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// --- Inventory Operations ---

export const saveInventory = async (parts: SparePart[], performerUsername: string) => {
  console.log(`[DB] Received payload: ${parts.length} items to save.`);
  
  // Try server REST API call first
  try {
    const res = await fetch(`${API_URL}/api/inventory/save-inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts, username: performerUsername })
    });
    if (res.ok) {
      console.log(`[DB API] Saved inventory via Express API.`);
      return;
    }
  } catch (err: any) {
    console.warn(`[DB API] Save inventory API failed: ${err.message}. Falling back to Firestore directly.`);
  }
  
  // Save to local storage first as a safety backup
  try {
    const existingStr = localStorage.getItem('spareshare_inventory');
    const existingList: SparePart[] = existingStr ? JSON.parse(existingStr) : [];
    parts.forEach(newPart => {
      const idx = existingList.findIndex(p => p.id === newPart.id);
      if (idx !== -1) {
        existingList[idx] = newPart;
      } else {
        existingList.push(newPart);
      }
    });
    localStorage.setItem('spareshare_inventory', JSON.stringify(existingList));
  } catch (err) {
    console.warn("[DB Fallback] Failed to save copy in localStorage:", err);
  }

  try {
    // Load previous states of these parts before writing
    const previousState: Record<string, any> = {};
    const updatedState: Record<string, any> = {};
    
    const ids = parts.map(p => p.id);
    const CHUNK_SIZE = 100;
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunkIds = ids.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunkIds.map(async (id) => {
        const ref = doc(db, 'inventory', id);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          previousState[id] = snap.data();
        } else {
          previousState[id] = { isNew: true };
        }
      }));
    }

    parts.forEach(part => {
      updatedState[part.id] = {
        onHand: part.onHand,
        totalValue: part.totalValue,
        consumptionQty: part.consumptionQty || 0,
        consumptionValue: part.consumptionValue || 0
      };
    });

    // Batch writes in Firestore are limited to 500 operations.
    const BATCH_SIZE = 450;
    const batches = [];

    // 1. Prepare all batches
    for (let i = 0; i < parts.length; i += BATCH_SIZE) {
      const chunk = parts.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);

      chunk.forEach(part => {
        const ref = doc(db, 'inventory', part.id);
        batch.set(ref, part);
      });
      batches.push(batch);
    }

    console.log(`[DB] Prepared ${batches.length} batches.`);

    // 2. Commit in concurrent chunks
    const CONCURRENCY_LIMIT = 5;
    let successCount = 0;
    
    for (let i = 0; i < batches.length; i += CONCURRENCY_LIMIT) {
      const currentBatches = batches.slice(i, i + CONCURRENCY_LIMIT);
      try {
        await Promise.all(currentBatches.map(b => b.commit()));
        successCount += currentBatches.reduce((acc, b, idx) => {
          const batchIdx = i + idx;
          const chunkSize = batches[batchIdx] === batches[batches.length - 1] 
            ? parts.length % BATCH_SIZE || BATCH_SIZE 
            : BATCH_SIZE;
          return acc + chunkSize;
        }, 0);
        console.log(`[DB] Progress: ${successCount} / ${parts.length} items committed.`);
      } catch (error) {
        console.error("[DB] Batch commit failed.", error);
        throw error;
      }
    }

    console.log(`[DB] Successfully saved ${successCount} total items to database.`);

    // Save Upload History Record
    if (parts.length > 0) {
      try {
        const historyId = `rep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const historyRef = doc(db, 'upload_history', historyId);
        const historyRec: UploadHistoryRecord = {
          id: historyId,
          timestamp: Date.now(),
          uploadedBy: performerUsername,
          fileName: 'Excel Template Upload',
          factoryId: parts[0].factoryId,
          reportType: 'EXCEL_TEMPLATE',
          previousState,
          updatedState
        };
        await setDoc(historyRef, historyRec);
      } catch (historyErr) {
        console.warn("[DB] Failed to log upload history:", historyErr);
      }
    }

    // Log the upload/create/edit action
    if (parts.length === 1) {
      try {
        const part = parts[0];
        const prev = previousState[part.id];
        const isNew = !prev || prev.isNew;

        const changes: Record<string, { old: any; new: any }> = {};
        if (!isNew) {
          Object.keys(part).forEach(key => {
            const oldVal = prev[key];
            const newVal = part[key as keyof SparePart];
            if (oldVal !== newVal) {
              changes[key] = { old: oldVal !== undefined ? oldVal : null, new: newVal !== undefined ? newVal : null };
            }
          });
        } else {
          Object.keys(part).forEach(key => {
            changes[key] = { old: null, new: part[key as keyof SparePart] };
          });
        }

        await logAction(
          performerUsername,
          isNew ? 'CREATED' : 'UPDATED',
          'inventory',
          part.id,
          isNew ? `Created item: ${part.description}` : `Updated item: ${part.description}`,
          {
            userName: performerUsername,
            plantId: part.factoryId,
            plantName: part.factoryId,
            changes
          }
        );
      } catch (auditError) {
        console.warn("[DB] Single item audit logging failed:", auditError);
      }
    } else if (parts.length > 1) {
      try {
        await logAction(
          performerUsername,
          'UPLOAD',
          'inventory',
          parts[0].factoryId, // Using factory ID as entity ID for bulk upload
          `Uploaded ${parts.length} items for ${parts[0].factoryId}`,
          {
            userName: performerUsername,
            plantId: parts[0].factoryId,
            plantName: parts[0].factoryId,
            changes: { count: parts.length }
          }
        );
      } catch (auditError) {
        console.warn("[DB] Bulk audit logging failed:", auditError);
      }
    }
  } catch (firestoreError: any) {
    console.warn("[DB Fallback] saveInventory failed to write to Firestore Cloud (Quota Exceeded). Utilizing local storage copy. Error:", firestoreError.message);
  }
};

export const getInventory = async (user?: User): Promise<SparePart[]> => {
  let localParts: SparePart[] = [];
  try {
    const localStr = localStorage.getItem('spareshare_inventory');
    const rawLocal: SparePart[] = localStr ? JSON.parse(localStr) : [];
    localParts = rawLocal.map(p => ({
      ...p,
      factoryId: resolvePlantId(p.factoryId)
    }));
  } catch (e) {
    localParts = [];
  }

  try {
    let querySnapshot = await getDocs(collection(db, 'inventory'));
    
    const firestoreParts: SparePart[] = [];
    querySnapshot.forEach((doc) => {
      const part = doc.data() as SparePart;
      if (part.is_deleted !== true) {
        firestoreParts.push({
          ...part,
          factoryId: resolvePlantId(part.factoryId)
        });
      }
    });

    // If Firestore returned items, merge with localParts without losing uploaded items
    if (firestoreParts.length > 0) {
      const localMap = new Map(localParts.map((p, i) => [p.id, i]));
      for (const fp of firestoreParts) {
        const idx = localMap.get(fp.id);
        if (idx !== undefined) {
          localParts[idx] = { ...fp, ...localParts[idx] };
        } else {
          localParts.push(fp);
        }
      }
    }

    if (localParts.length > 0) {
      try {
        localStorage.setItem('spareshare_inventory', JSON.stringify(localParts));
      } catch (e) {
        console.warn("[DB Fallback] Failed to sync to localStorage:", e);
      }
    }
    return localParts;
  } catch (error: any) {
    console.warn("[DB Fallback] getInventory failed to read from Firestore. Utilizing local storage copy. Error:", error.message);
    return localParts;
  }
};

export const updateSparePart = async (part: SparePart, performerUsername: string) => {
  // Update local storage copy first
  try {
    const existingStr = localStorage.getItem('spareshare_inventory');
    const existingList: SparePart[] = existingStr ? JSON.parse(existingStr) : [];
    const idx = existingList.findIndex(p => p.id === part.id);
    if (idx !== -1) {
      existingList[idx] = part;
    } else {
      existingList.push(part);
    }
    localStorage.setItem('spareshare_inventory', JSON.stringify(existingList));
  } catch (err) {
    console.warn("[DB Fallback] Failed to update copy in localStorage:", err);
  }

  try {
    const ref = doc(db, 'inventory', part.id);
    const snap = await getDoc(ref);
    const previousState = snap.exists() ? snap.data() as SparePart : null;

    await setDoc(ref, part);

    const changes: Record<string, { old: any; new: any }> = {};
    if (previousState) {
      Object.keys(part).forEach(key => {
        const oldVal = previousState[key as keyof SparePart];
        const newVal = part[key as keyof SparePart];
        if (oldVal !== newVal) {
          changes[key] = { old: oldVal !== undefined ? oldVal : null, new: newVal !== undefined ? newVal : null };
        }
      });
    } else {
      Object.keys(part).forEach(key => {
        changes[key] = { old: null, new: part[key as keyof SparePart] };
      });
    }

    await logAction(
      performerUsername,
      previousState ? 'UPDATED' : 'CREATED',
      'inventory',
      part.id,
      previousState ? `Updated item: ${part.description}` : `Created item: ${part.description}`,
      {
        userName: performerUsername,
        plantId: part.factoryId,
        plantName: part.factoryId,
        changes
      }
    );
  } catch (error: any) {
    console.warn("[DB Fallback] updateSparePart failed to write to Firestore Cloud (Quota Exceeded). Utilizing local storage copy. Error:", error.message);
  }
};

// --- Order Operations ---

const PLANT_EMAILS: Record<string, string> = {
  'Lanka Tiles': 'lankatiles.admin@gmail.com',
  'Lanka Wall Tiles': 'lankawalltiles.admin@gmail.com',
  'Rocell Horana': 'rocellhorana.admin@gmail.com',
  'Rocell Eheliyagoda': 'rocelleheliyagoda.admin@gmail.com'
};

export const createOrder = async (
  items: import('../types').CartItem[],
  username: string
): Promise<void> => {
  // Group items by Factory ID
  const itemsByFactory: Record<string, import('../types').CartItem[]> = {};

  items.forEach(item => {
    if (!itemsByFactory[item.factoryId]) {
      itemsByFactory[item.factoryId] = [];
    }
    itemsByFactory[item.factoryId].push(item);
  });

  const localOrdersToSave: Order[] = [];

  // Create separate order for each factory group
  Object.entries(itemsByFactory).forEach(([factoryId, factoryItems]) => {
    const orderId = `ord-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const totalValue = factoryItems.reduce((sum, item) => sum + (item.unitCost * item.orderQty), 0);

    const plantEmail = PLANT_EMAILS[factoryId] || 'admin@gmail.com';

    const order: Order = {
      id: orderId,
      items: factoryItems.map(item => ({
        sparePartId: item.id,
        sparePartDescription: item.description,
        partNumber: item.partNumber || '',  // Save Snapshot
        machine: item.machine || '',        // Save Snapshot
        fromFactory: item.factoryId,
        quantity: item.orderQty,
        unitCost: item.unitCost,
        totalValue: item.unitCost * item.orderQty,
        status: 'pending' // Initialize item status
      })),
      totalValue,
      requestedBy: username,
      userEmail: username, // Explicitly include user email address in Firestore order document
      plantEmail: plantEmail, // Explicitly include plant manager email in Firestore order document
      status: 'pending',
      createdAt: Date.now()
    };

    localOrdersToSave.push(order);
  });

  // Save copy to local storage
  try {
    const existingStr = localStorage.getItem('spareshare_orders');
    const existingList: Order[] = existingStr ? JSON.parse(existingStr) : [];
    localStorage.setItem('spareshare_orders', JSON.stringify([...existingList, ...localOrdersToSave]));
  } catch (err) {
    console.warn("[DB Fallback] Failed to save orders copy in localStorage:", err);
  }

  // Fetch ordering user's plant affiliation
  let userFactory = 'Unknown Plant';
  try {
    const userDocRef = doc(db, 'users', username);
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const uData = userSnap.data() as User;
      userFactory = uData.factoryAffiliation || 'Unknown Plant';
    }
  } catch (e) {
    console.warn("[DB] Failed to fetch ordering user factory affiliation:", e);
  }

  try {
    const batch = writeBatch(db);
    localOrdersToSave.forEach(order => {
      const ref = doc(db, 'orders', order.id);
      batch.set(ref, order);
      logAction(
        username,
        'CREATE',
        'order',
        order.id,
        `Created order for factory ${order.items[0].fromFactory} with ${order.items.length} items.`
      );
    });
    await batch.commit();

    // Trigger emails by notifying the backend OrderCreated listener asynchronously
    try {
      const { notifyOrderCreated } = await import('./apiService');
      for (const order of localOrdersToSave) {
        await notifyOrderCreated({
          order,
          userEmail: username,
          plantEmail: order.plantEmail || 'admin@gmail.com',
          userFactory
        });
      }
    } catch (emailErr) {
      console.warn("[DB] Failed to notify backend of OrderCreated event:", emailErr);
    }
  } catch (error: any) {
    console.warn("[DB Fallback] createOrder failed to write to Firestore Cloud (Quota Exceeded). Utilizing local storage copy. Error: " + error.message);
  }
};

export const getOrders = async (user?: User): Promise<Order[]> => {
  let allOrders: Order[] = [];
  let isLoadedFromCloud = false;

  try {
    const querySnapshot = await getDocs(collection(db, 'orders'));
    querySnapshot.forEach((doc) => {
      const data = doc.data() as Order;
      if (data.items && data.items.length > 0) {
        allOrders.push(data);
      }
    });
    isLoadedFromCloud = true;
    // Sync to local storage
    try {
      localStorage.setItem('spareshare_orders', JSON.stringify(allOrders));
    } catch (e) {
      console.warn("[DB Fallback] Failed to sync orders to localStorage:", e);
    }
  } catch (e: any) {
    console.warn("[DB Fallback] getOrders failed to read from Firestore (Quota Exceeded). Utilizing local storage copy. Error:", e.message);
    try {
      const local = localStorage.getItem('spareshare_orders');
      allOrders = local ? JSON.parse(local) : [];
    } catch (err) {
      console.error("[DB Fallback] Failed to read orders from localStorage:", err);
    }
  }

  // Filter Logic:
  // 1. Admin sees everything.
  // 2. User sees orders they REQUESTED.
  // 3. User sees orders targeted TO THEIR FACTORY.
  const filteredOrders: Order[] = [];
  allOrders.forEach(data => {
    if (user) {
      if (user.role === 'admin') {
        filteredOrders.push(data);
      } else {
        const isRequester = data.requestedBy === user.username;
        const isTargetFactory = user.factoryAffiliation && data.items[0].fromFactory === user.factoryAffiliation;
        if (isRequester || isTargetFactory) {
          filteredOrders.push(data);
        }
      }
    } else {
      filteredOrders.push(data);
    }
  });

  return filteredOrders;
};

export const processOrderItem = async (orderId: string, itemPartId: string, status: OrderStatus, performerUsername: string) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderSnap = await getDoc(orderRef);

  if (!orderSnap.exists()) {
    throw new Error("Order not found");
  }

  const order = orderSnap.data() as Order;
  const itemIndex = order.items.findIndex(i => i.sparePartId === itemPartId);

  if (itemIndex === -1) throw new Error("Item not found in order");

  const item = order.items[itemIndex];

  // LOGIC:
  // 1. 'approved' -> Just marks the item as approved (Reserved). NO Stock Deduction yet.
  // 2. 'delivered' -> Marks as delivered AND Deducts Stock.
  // 3. 'rejected' -> Just marks as rejected.

  if (status === 'delivered' && item.status !== 'delivered') {
    // FINAL STOCK DEDUCTION
    const batch = writeBatch(db);

    const partRef = doc(db, 'inventory', item.sparePartId);
    const partSnap = await getDoc(partRef);

    if (!partSnap.exists()) {
      throw new Error(`Part ${item.sparePartDescription} not found`);
    }

    const part = partSnap.data() as SparePart;

    // Double check stock (even though we might have reserved it visually, physical stock must be there)
    if (part.onHand < item.quantity) {
      throw new Error(`Insufficient physical stock for ${item.sparePartDescription} to deliver.`);
    }

    const newOnHand = part.onHand - item.quantity;
    const newTotalValue = newOnHand * part.unitCost;

    batch.update(partRef, { onHand: newOnHand, totalValue: newTotalValue });

    // Update item status
    order.items[itemIndex].status = 'delivered';

    // Update Order Status
    // If all items are 'delivered' or 'rejected', order is complete.
    // For now, let's just update the main status to 'delivered' if all items are delivered.
    const allDelivered = order.items.every(i => i.status === 'delivered' || i.status === 'rejected');
    const mainStatus = allDelivered ? 'delivered' : 'approved'; // Keep as approved/partial until fully delivered

    batch.update(orderRef, { items: order.items, status: mainStatus });
    await batch.commit();

    await logAction(
      performerUsername,
      'ORDER_PROCESS',
      'order',
      orderId,
      `Delivered item: ${item.sparePartDescription} (Qty: ${item.quantity})`
    );

  } else if (status === 'approved' && item.status === 'pending') {
    // RESERVATION ONLY (No physical deduction yet)
    // We just update the status.
    order.items[itemIndex].status = 'approved';

    const batch = writeBatch(db);

    // Check if all are processed to move main status out of pending
    const allProcessed = order.items.every(i => i.status !== 'pending');
    const mainStatus = allProcessed ? 'approved' : 'pending';

    batch.update(orderRef, { items: order.items, status: mainStatus, approvedAt: Date.now() });
    await batch.commit();

    // C. Email back to ordering user
    try {
      const { sendEmailNotification } = await import('./apiService');
      const portalUrl = window.location.origin;
      const orderUrl = `${portalUrl}/orders/${orderId}`;
      const emailToRequester = {
        to: order.requestedBy.includes('@') ? order.requestedBy : 'admin@gmail.com',
        subject: `Order Confirmed by ${item.fromFactory}`,
        text: `Hello ${order.requestedBy},\n\nYour order for ${item.sparePartDescription} (Qty: ${item.quantity}, Price: Rs. ${item.totalValue.toLocaleString()}) has been confirmed by ${item.fromFactory}.\n\nOrder ID: ${orderId}\n\nYou can view the updated order status directly in the portal: ${orderUrl}\n\nThank you,\nSpare Parts Portal`,
        html: `<p>Hello <strong>${order.requestedBy}</strong>,</p>
               <p>Your order for <strong>${item.sparePartDescription}</strong> (Qty: ${item.quantity}, Price: Rs. ${item.totalValue.toLocaleString()}) has been confirmed by <strong>${item.fromFactory}</strong>.</p>
               <p><strong>Order ID:</strong> ${orderId}</p>
               <p><a href="${orderUrl}" style="display:inline-block;padding:10px 20px;background-color:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;">View Order Details</a></p>
               <p>Or copy this link: <a href="${orderUrl}">${orderUrl}</a></p>
               <p>Thank you,<br/>Spare Parts Portal</p>`
      };
      sendEmailNotification(emailToRequester).catch(err => console.warn("[DB] Failed to send confirmation email", err));
    } catch (err) {
      console.warn("[DB] Failed to load email api service dynamically:", err);
    }

    await logAction(
      performerUsername,
      'ORDER_PROCESS',
      'order',
      orderId,
      `Approved item: ${item.sparePartDescription} (Qty: ${item.quantity})`
    );

  } else {
    // Rejecting or resetting
    order.items[itemIndex].status = status;

    const allProcessed = order.items.every(i => i.status !== 'pending');
    // If we reject, we might still be pending if other items are pending
    const mainStatus = allProcessed ? (order.items.some(i => i.status === 'approved' || i.status === 'delivered') ? 'approved' : 'rejected') : 'pending';

    await setDoc(orderRef, { ...order, items: order.items, status: mainStatus });

    await logAction(
      performerUsername,
      'ORDER_PROCESS',
      'order',
      orderId,
      `${status === 'rejected' ? 'Rejected' : 'Reset'} item: ${item.sparePartDescription}`
    );
  }
};

// --- Auth ---

/**
 * Simple SHA-256 hash using Web Crypto API.
 * In production, use a library like bcrypt with proper salting on the server.
 */
const hashPassword = async (password: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
};

export const registerUser = async (user: User, password: string): Promise<void> => {
  // Check if username already exists
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('username', '==', user.username));
  const querySnapshot = await getDocs(q);

  if (!querySnapshot.empty) {
    throw new Error('Username already taken');
  }

  const hashedPassword = await hashPassword(password);

  // Save user to Firestore 'users' collection
  await setDoc(doc(db, 'users', user.username), {
    ...user,
    approved: false, // Default to unapproved
    password: hashedPassword
  });
};

export const loginUser = async (username: string, password: string): Promise<User | null> => {
  // 1. Hardcoded Admin (Legacy/Fallback)
  if (username === 'admin' && password === 'vone') {
    return { username: 'admin', role: 'admin', approved: true };
  }

  // 2. Dynamic Users from Firestore
  try {
    const userDocRef = doc(db, 'users', username);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
      const userData = userDoc.data();
      const inputHash = await hashPassword(password);

      // Check Password: Try Hash match first, then fallback to Plaintext (for migration)
      const isHashMatch = userData.password === inputHash;
      const isPlainMatch = userData.password === password;

      if (isHashMatch || isPlainMatch) {

        // Check Approval
        if (!userData.approved) {
          throw new Error("Account pending approval");
        }

        // Return user info (excluding password)
        return {
          username: userData.username,
          role: userData.role,
          factoryAffiliation: userData.factoryAffiliation,
          approved: userData.approved
        };
      }
    }
  } catch (e) {
    console.error("Login error:", e);
    throw e; // Re-throw to handle specific errors like "Account pending approval"
  }

  return null;
};

// --- Admin User Management ---

export const getPendingUsers = async (): Promise<User[]> => {
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('approved', '==', false));
  const querySnapshot = await getDocs(q);

  const users: User[] = [];
  querySnapshot.forEach((doc) => {
    // Exclude password
    const data = doc.data();
    users.push({
      username: data.username,
      role: data.role,
      factoryAffiliation: data.factoryAffiliation,
      approved: data.approved
    });
  });
  return users;
};

export const getAllUsers = async (): Promise<User[]> => {
  const usersRef = collection(db, 'users');
  const querySnapshot = await getDocs(usersRef);

  const users: User[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    users.push({
      username: data.username,
      role: data.role,
      factoryAffiliation: data.factoryAffiliation,
      approved: data.approved
    });
  });
  return users;
};

export const approveUser = async (username: string, performerUsername: string, factoryAffiliation?: string) => {
  const userRef = doc(db, 'users', username);
  const updateData: any = { approved: true };
  if (factoryAffiliation) {
    updateData.factoryAffiliation = factoryAffiliation;
  }
  await setDoc(userRef, updateData, { merge: true });
  await logAction(
    performerUsername,
    'USER_APPROVE',
    'user',
    username,
    `Approved user registration: ${username}${factoryAffiliation ? ` with factory ${factoryAffiliation}` : ''}`
  );
};

export const deleteUser = async (username: string, performerUsername: string) => {
  await deleteDoc(doc(db, 'users', username));
  await logAction(
    performerUsername,
    'DELETE',
    'user',
    username,
    `Deleted user: ${username}`
  );
};

// --- Helper for Robust Deletions ---

/**
 * Standardizes bulk deletion to avoid Firestore's 500-operation batch limit.
 */
const deleteInBatches = async (querySnapshot: any) => {
  const BATCH_SIZE = 450;
  const docs = querySnapshot.docs;
  
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = docs.slice(i, i + BATCH_SIZE);
    chunk.forEach((d: any) => batch.delete(d.ref));
    await batch.commit();
    console.log(`[DB] Deleted batch of ${chunk.length} documents.`);
  }
};

export const clearDatabase = async (performerUsername: string) => {
  // 1. Clear Inventory
  console.log("[DB] Clearing Inventory...");
  const inventorySnapshot = await getDocs(collection(db, 'inventory'));
  await deleteInBatches(inventorySnapshot);

  // 2. Clear Orders
  console.log("[DB] Clearing Orders...");
  const ordersSnapshot = await getDocs(collection(db, 'orders'));
  await deleteInBatches(ordersSnapshot);

  await logAction(
    performerUsername,
    'CLEAR_DATABASE',
    'inventory',
    'all',
    `Cleared all data (${inventorySnapshot.size} parts, ${ordersSnapshot.size} orders)`
  );
};

export const clearOrders = async (performerUsername: string) => {
  const ordersSnapshot = await getDocs(collection(db, 'orders'));
  if (ordersSnapshot.empty) return;

  await deleteInBatches(ordersSnapshot);

  await logAction(
    performerUsername,
    'CLEAR_DATABASE',
    'order',
    'all',
    `Cleared ${ordersSnapshot.size} order history records`
  );
};

export const clearAuditLogs = async (performerUsername: string) => {
  const snapshot = await getDocs(collection(db, 'audit_logs'));
  if (snapshot.empty) return;

  await deleteInBatches(snapshot);

  await logAction(
    performerUsername,
    'CLEAR_DATABASE',
    'audit_logs',
    'all',
    `Cleared all security audit logs (${snapshot.size} records)`
  );
};

export const deleteFactoryData = async (factoryId: string, performerUsername: string) => {
  // Query all inventory items for this factory
  const inventoryRef = collection(db, 'inventory');
  const q = query(inventoryRef, where('factoryId', '==', factoryId));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) return;

  await deleteInBatches(querySnapshot);

  await logAction(
    performerUsername,
    'DELETE',
    'inventory',
    factoryId,
    `Deleted ${querySnapshot.size} inventory items for factory: ${factoryId}`
  );
};

/**
 * Commits partial or full spare parts updates from system reports into Firestore.
 * For daily consumption (MB51 or Transaction), it subtracts the consumption quantity from current stock.
 * For stock reports (MB52 or Subinventory), it sets or merges the stock level.
 */

export const saveSystemReport = async (
  factoryId: string,
  reportType: string,
  updatedParts: Partial<SparePart>[],
  performerUsername: string,
  reportDate?: string
): Promise<{ updatedCount: number; deductedCount: number }> => {
  // Try server REST API call first
  try {
    const res = await fetch(`${API_URL}/api/inventory/save-system-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factoryId, reportType, updatedParts, username: performerUsername, reportDate })
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`[DB API] Saved system report via Express API.`);
      return { updatedCount: data.updatedCount, deductedCount: data.deductedCount };
    }
  } catch (err: any) {
    console.warn(`[DB API] Save system report API failed: ${err.message}. Falling back to Firestore directly.`);
  }

  const BATCH_SIZE = 450;
  let updatedCount = 0;
  let deductedCount = 0;

  // Track previous and updated states of modified parts
  const previousState: Record<string, any> = {};
  const updatedState: Record<string, any> = {};

  for (let i = 0; i < updatedParts.length; i += BATCH_SIZE) {
    const chunk = updatedParts.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    await Promise.all(chunk.map(async (partUpdate) => {
      const partId = partUpdate.id!;
      const ref = doc(db, 'inventory', partId);

      if (reportType.includes('MB51') || reportType.includes('TRANSACTION')) {
        // Daily Consumption: Subtract quantity from active stock
        const docSnap = await getDoc(ref);
        if (docSnap.exists()) {
          const currentData = docSnap.data() as SparePart;
          const consumptionQty = partUpdate.qtyMoreThan3Years || 0;
          const newOnHand = Math.max(0, currentData.onHand - consumptionQty);
          const newTotalValue = newOnHand * currentData.unitCost;

          // Record and accumulate consumption metrics
          const newConsumptionQty = (currentData.consumptionQty || 0) + consumptionQty;
          const newConsumptionValue = newConsumptionQty * currentData.unitCost;

          previousState[partId] = {
            onHand: currentData.onHand,
            totalValue: currentData.totalValue,
            consumptionQty: currentData.consumptionQty || 0,
            consumptionValue: currentData.consumptionValue || 0
          };

          updatedState[partId] = {
            onHand: newOnHand,
            totalValue: newTotalValue,
            consumptionQty: newConsumptionQty,
            consumptionValue: newConsumptionValue
          };

          const updateObj: any = {
            onHand: newOnHand,
            totalValue: newTotalValue,
            consumptionQty: newConsumptionQty,
            consumptionValue: newConsumptionValue,
            lastStockUpdateUser: performerUsername
          };
          if (reportDate) {
            updateObj.lastStockUpdateDate = reportDate;
          }

          batch.update(ref, updateObj);
          deductedCount++;
        }
      } else {
        // Stock Report: Set or merge stock levels
        const docSnap = await getDoc(ref);
        if (docSnap.exists()) {
          const currentData = docSnap.data() as SparePart;
          const updateData: any = {
            onHand: partUpdate.onHand,
            lastStockUpdateUser: performerUsername
          };
          if (partUpdate.totalValue !== undefined && partUpdate.totalValue > 0) {
            updateData.totalValue = partUpdate.totalValue;
            updateData.unitCost = partUpdate.unitCost;
          } else {
            updateData.totalValue = partUpdate.onHand! * currentData.unitCost;
          }
          if (reportDate) {
            updateData.lastStockUpdateDate = reportDate;
          }

          previousState[partId] = {
            onHand: currentData.onHand,
            totalValue: currentData.totalValue,
            consumptionQty: currentData.consumptionQty || 0,
            consumptionValue: currentData.consumptionValue || 0
          };

          updatedState[partId] = {
            onHand: partUpdate.onHand || 0,
            totalValue: updateData.totalValue,
            consumptionQty: currentData.consumptionQty || 0,
            consumptionValue: currentData.consumptionValue || 0
          };

          batch.update(ref, updateData);
          updatedCount++;
        } else {
          // If the part does not exist, create it as a new catalog item
          const newPart: SparePart = {
            id: partId,
            factoryId: partUpdate.factoryId || factoryId,
            materialNumber: partUpdate.materialNumber!,
            partNumber: partUpdate.partNumber || partUpdate.materialNumber!,
            description: partUpdate.description || 'System Spare Part',
            qtyMoreThan3Years: 0,
            valueMoreThan3Years: 0,
            onHand: partUpdate.onHand || 0,
            unitCost: partUpdate.unitCost || 0,
            totalValue: partUpdate.totalValue || 0,
            spareType: 'General',
            categoryName: '-',
            machine: '-',
            criticality: '-',
            lastStockUpdateUser: performerUsername,
            ...(reportDate ? { lastStockUpdateDate: reportDate } : {})
          };

          previousState[partId] = { isNew: true };
          updatedState[partId] = {
            onHand: newPart.onHand,
            totalValue: newPart.totalValue,
            consumptionQty: 0,
            consumptionValue: 0
          };

          batch.set(ref, newPart);
          updatedCount++;
        }
      }
    }));

    await batch.commit();
  }

  // Save Upload History Record
  if (updatedCount > 0 || deductedCount > 0) {
    try {
      const historyId = `rep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const historyRef = doc(db, 'upload_history', historyId);
      const historyRec: UploadHistoryRecord = {
        id: historyId,
        timestamp: Date.now(),
        uploadedBy: performerUsername,
        fileName: `${reportType} Report`,
        factoryId: factoryId,
        reportType: reportType,
        previousState,
        updatedState,
        ...(reportDate ? { reportDate } : {})
      };
      await setDoc(historyRef, historyRec);
    } catch (historyErr) {
      console.warn("[DB] Failed to log upload history:", historyErr);
    }
  }

  // Log audit action
  await logAction(
    performerUsername,
    'UPLOAD',
    'inventory',
    factoryId,
    `Uploaded ${reportType} report for factory ${factoryId}. Updated: ${updatedCount}, Consumption Deducted: ${deductedCount}`
  );

  return { updatedCount, deductedCount };
};

// --- Historical Consumption Operations ---

export const saveHistoricalConsumption = async (
  records: HistoricalConsumptionRecord[],
  performerUsername: string
): Promise<void> => {
  const batch = writeBatch(db);
  records.forEach((record) => {
    const recordId = `${record.factoryId}-${record.year}`.replace(/\s+/g, '_');
    const ref = doc(db, 'historical_consumption', recordId);
    batch.set(ref, {
      ...record,
      id: recordId,
      timestamp: Date.now(),
      uploadedBy: performerUsername
    });
  });
  await batch.commit();

  await logAction(
    performerUsername,
    'UPLOAD',
    'historical_consumption',
    'all',
    `Uploaded ${records.length} historical consumption records`
  );
};

export const seedMockHistoricalConsumption = async (): Promise<HistoricalConsumptionRecord[]> => {
  const mockRecords: HistoricalConsumptionRecord[] = [
    { id: 'Lanka_Tiles-2023', factoryId: 'Lanka Tiles', year: 2023, consumptionQty: 12000, consumptionValue: 4500000, uploadedBy: 'system', timestamp: Date.now() },
    { id: 'Lanka_Tiles-2024', factoryId: 'Lanka Tiles', year: 2024, consumptionQty: 14500, consumptionValue: 5200000, uploadedBy: 'system', timestamp: Date.now() },
    { id: 'Lanka_Tiles-2025', factoryId: 'Lanka Tiles', year: 2025, consumptionQty: 16000, consumptionValue: 5800000, uploadedBy: 'system', timestamp: Date.now() },
    
    { id: 'Lanka_Wall_Tiles-2023', factoryId: 'Lanka Wall Tiles', year: 2023, consumptionQty: 9500, consumptionValue: 3800000, uploadedBy: 'system', timestamp: Date.now() },
    { id: 'Lanka_Wall_Tiles-2024', factoryId: 'Lanka Wall Tiles', year: 2024, consumptionQty: 11000, consumptionValue: 4200000, uploadedBy: 'system', timestamp: Date.now() },
    { id: 'Lanka_Wall_Tiles-2025', factoryId: 'Lanka Wall Tiles', year: 2025, consumptionQty: 13000, consumptionValue: 4900000, uploadedBy: 'system', timestamp: Date.now() },
    
    { id: 'Rocell_Horana-2023', factoryId: 'Rocell Horana', year: 2023, consumptionQty: 15000, consumptionValue: 6200000, uploadedBy: 'system', timestamp: Date.now() },
    { id: 'Rocell_Horana-2024', factoryId: 'Rocell Horana', year: 2024, consumptionQty: 17200, consumptionValue: 7100000, uploadedBy: 'system', timestamp: Date.now() },
    { id: 'Rocell_Horana-2025', factoryId: 'Rocell Horana', year: 2025, consumptionQty: 19000, consumptionValue: 8000000, uploadedBy: 'system', timestamp: Date.now() },
    
    { id: 'Rocell_Eheliyagoda-2023', factoryId: 'Rocell Eheliyagoda', year: 2023, consumptionQty: 8000, consumptionValue: 3100000, uploadedBy: 'system', timestamp: Date.now() },
    { id: 'Rocell_Eheliyagoda-2024', factoryId: 'Rocell Eheliyagoda', year: 2024, consumptionQty: 9800, consumptionValue: 3700000, uploadedBy: 'system', timestamp: Date.now() },
    { id: 'Rocell_Eheliyagoda-2025', factoryId: 'Rocell Eheliyagoda', year: 2025, consumptionQty: 11500, consumptionValue: 4400000, uploadedBy: 'system', timestamp: Date.now() }
  ];

  const batch = writeBatch(db);
  mockRecords.forEach((record) => {
    const ref = doc(db, 'historical_consumption', record.id);
    batch.set(ref, record);
  });
  await batch.commit();
  return mockRecords;
};

export const getHistoricalConsumption = async (user?: User): Promise<HistoricalConsumptionRecord[]> => {
  try {
    const querySnapshot = await getDocs(collection(db, 'historical_consumption'));
    const records: HistoricalConsumptionRecord[] = [];
    querySnapshot.forEach((doc) => {
      records.push(doc.data() as HistoricalConsumptionRecord);
    });
    if (records.length === 0) {
      console.log("[DB] No historical consumption found. Seeding mock data...");
      const seeded = await seedMockHistoricalConsumption();
      if (user && user.role !== 'admin' && user.factoryAffiliation) {
        return seeded.filter(r => r.factoryId === user.factoryAffiliation);
      }
      return seeded;
    }
    if (user && user.role !== 'admin' && user.factoryAffiliation) {
      return records.filter(r => r.factoryId === user.factoryAffiliation);
    }
    return records;
  } catch (error) {
    console.error("Error fetching historical consumption:", error);
    return [];
  }
};

export const getUploadHistory = async (): Promise<UploadHistoryRecord[]> => {
  try {
    const querySnapshot = await getDocs(collection(db, 'upload_history'));
    const records: UploadHistoryRecord[] = [];
    querySnapshot.forEach((doc) => {
      records.push(doc.data() as UploadHistoryRecord);
    });
    return records.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error("Error fetching upload history:", error);
    return [];
  }
};

export const revertUpload = async (historyId: string, performerUser: User | string): Promise<void> => {
  const username = typeof performerUser === 'string' ? performerUser : performerUser.username;
  const role = typeof performerUser === 'object' ? performerUser.role : (username === 'admin' ? 'admin' : 'user');

  if (role !== 'admin' && username !== 'admin' && username !== 'admin@spareshare.com') {
    throw new Error("Unauthorized: Only system administrators can revert inventory history.");
  }

  // Try server REST API call first
  try {
    const res = await fetch(`${API_URL}/api/history/revert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': role,
        'x-user-name': username,
        'x-user-email': username.includes('@') ? username : (username === 'admin' ? 'admin@spareshare.com' : 'user@spareshare.com')
      },
      body: JSON.stringify({ historyId, batchId: historyId, username, role })
    });

    if (res.status === 403) {
      const errData = await res.json();
      throw new Error(errData.error || "Unauthorized: Only system administrators can revert inventory history.");
    }

    if (res.ok) {
      console.log(`[DB API] Reverted upload ${historyId} via Express API.`);
      return;
    }
  } catch (err: any) {
    if (err.message && err.message.includes("Unauthorized")) {
      throw err;
    }
    console.warn(`[DB API] Revert API call failed: ${err.message}. Falling back to Firestore directly.`);
  }

  // Fallback to direct Firestore write
  const historyRef = doc(db, 'upload_history', historyId);
  const historySnap = await getDoc(historyRef);
  if (!historySnap.exists()) {
    throw new Error("Upload history record not found");
  }
  const record = historySnap.data() as UploadHistoryRecord;
  const batch = writeBatch(db);

  const previousState = typeof record.previousState === 'string' ? JSON.parse(record.previousState) : record.previousState;

  // Revert each part in previousState
  Object.entries(previousState || {}).forEach(([partId, prevState]: [string, any]) => {
    const partRef = doc(db, 'inventory', partId);
    if (prevState.isNew) {
      batch.delete(partRef);
    } else {
      const { isNew, ...rest } = prevState;
      batch.set(partRef, rest, { merge: true });
    }
  });

  // Delete history doc
  batch.delete(historyRef);

  await batch.commit();

  // Log REVERT action in audit history
  await logAction(
    username,
    'REVERT',
    'inventory',
    record.factoryId,
    `Reverted upload ${historyId} (${record.fileName}) for factory ${record.factoryId}`,
    { userName: username, plantId: record.factoryId, plantName: record.factoryId }
  );
};

export const softDeleteSparePart = async (partId: string, performerUsername: string): Promise<void> => {
  // Try server REST API call first
  try {
    const res = await fetch(`${API_URL}/api/inventory/${partId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: performerUsername })
    });
    if (res.ok) {
      console.log(`[DB API] Soft deleted ${partId} via Express API.`);
      return;
    }
  } catch (err: any) {
    console.warn(`[DB API] Soft delete API failed: ${err.message}. Falling back to Firestore directly.`);
  }

  // Fallback to direct Firestore write
  const ref = doc(db, 'inventory', partId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("Item not found");
  }
  const part = snap.data() as SparePart;

  const updatedPart = {
    ...part,
    is_deleted: true,
    deleted_at: Date.now()
  };

  await setDoc(ref, updatedPart);

  // Sync to local storage
  try {
    const existingStr = localStorage.getItem('spareshare_inventory');
    const existingList: SparePart[] = existingStr ? JSON.parse(existingStr) : [];
    const idx = existingList.findIndex(p => p.id === partId);
    if (idx !== -1) {
      existingList[idx] = updatedPart;
    }
    localStorage.setItem('spareshare_inventory', JSON.stringify(existingList));
  } catch (err) {
    console.warn("[DB Fallback] Failed to update copy in localStorage:", err);
  }

  // Log action
  await logAction(
    performerUsername,
    'DELETED',
    'inventory',
    partId,
    `Soft-deleted item: ${part.description}`,
    {
      userName: performerUsername,
      plantId: part.factoryId,
      plantName: part.factoryId,
      changes: {
        is_deleted: { old: part.is_deleted || false, new: true }
      }
    }
  );
};

export const restoreSparePart = async (partId: string, performerUsername: string): Promise<void> => {
  // Try server REST API call first
  try {
    const res = await fetch(`${API_URL}/api/audit/restore/${partId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: performerUsername })
    });
    if (res.ok) {
      console.log(`[DB API] Restored ${partId} via Express API.`);
      return;
    }
  } catch (err: any) {
    console.warn(`[DB API] Restore API failed: ${err.message}. Falling back to Firestore directly.`);
  }

  // Fallback to direct Firestore write
  const ref = doc(db, 'inventory', partId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("Item not found");
  }
  const part = snap.data() as SparePart;

  const updatedPart = {
    ...part,
    is_deleted: false,
    deleted_at: null
  };

  await setDoc(ref, updatedPart);

  // Sync to local storage
  try {
    const existingStr = localStorage.getItem('spareshare_inventory');
    const existingList: SparePart[] = existingStr ? JSON.parse(existingStr) : [];
    const idx = existingList.findIndex(p => p.id === partId);
    if (idx !== -1) {
      existingList[idx] = updatedPart;
    }
    localStorage.setItem('spareshare_inventory', JSON.stringify(existingList));
  } catch (err) {
    console.warn("[DB Fallback] Failed to update copy in localStorage:", err);
  }

  // Log action
  await logAction(
    performerUsername,
    'RESTORED',
    'inventory',
    partId,
    `Restored item: ${part.description}`,
    {
      userName: performerUsername,
      plantId: part.factoryId,
      plantName: part.factoryId,
      changes: {
        is_deleted: { old: true, new: false }
      }
    }
  );
};

export const permanentDeleteSparePart = async (partId: string, performerUsername: string): Promise<void> => {
  // Try server REST API call first
  try {
    const res = await fetch(`${API_URL}/api/inventory/${partId}/permanent`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: performerUsername })
    });
    if (res.ok) {
      console.log(`[DB API] Permanently deleted ${partId} via Express API.`);
      return;
    }
  } catch (err: any) {
    console.warn(`[DB API] Permanent delete API failed: ${err.message}. Falling back to Firestore directly.`);
  }

  // Fallback to direct Firestore write
  const ref = doc(db, 'inventory', partId);
  await deleteDoc(ref);

  // Sync to local storage
  try {
    const existingStr = localStorage.getItem('spareshare_inventory');
    const existingList: SparePart[] = existingStr ? JSON.parse(existingStr) : [];
    const filtered = existingList.filter(p => p.id !== partId);
    localStorage.setItem('spareshare_inventory', JSON.stringify(filtered));
  } catch (err) {
    console.warn("[DB Fallback] Failed to update copy in localStorage:", err);
  }

  // Log action
  await logAction(
    performerUsername,
    'DELETED',
    'inventory',
    partId,
    `Permanently deleted item: ${partId}`,
    {
      userName: performerUsername,
      plantId: 'System',
      plantName: 'System',
      changes: { permanent_delete: true }
    }
  );
};

export const syncGoogleSheets = async (performerUsername: string): Promise<void> => {
  const endpoints = [
    `${API_URL}/api/sync-sheets`,
    `/api/sync-sheets`,
    `${API_URL}/sync-sheets`
  ];

  let lastError: string = '';

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: performerUsername })
      });

      if (res.ok) {
        return;
      }

      const errorData = await res.json().catch(() => ({}));
      lastError = errorData.error || errorData.message || `Server returned HTTP ${res.status}${res.statusText ? ': ' + res.statusText : ''}`;
    } catch (err: any) {
      lastError = err.message || 'Network error or backend server unreachable';
    }
  }

  throw new Error(lastError || 'Backend server is offline or unreachable. Please ensure the backend server (server.js) is running and VITE_API_URL is configured.');
};
