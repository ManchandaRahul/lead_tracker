import { db } from "./config";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";

export type ActivityAction =
  | "LEAD_ADDED"
  | "LEAD_EDITED"
  | "LEAD_STATUS_CHANGED"
  | "LEAD_DELETED"
  | "TXN_ADDED"
  | "TXN_EDITED"
  | "TXN_DELETED";

export interface HistoryEntry {
  actionType: ActivityAction;
  description: string;
  previousValue?: string;
  newValue?: string;
  actionBy: string;
  timestamp: string;
}

export interface ActivityDocument {
  referenceId: string;       // leadId or transactionId — also used as Firestore doc ID
  referenceName: string;     // accountName for display
  module: "leads" | "transactions";
  history: HistoryEntry[];
  lastUpdated: string;
  lastActionBy: string;
}

export async function logActivity(
  referenceId: string,
  referenceName: string,
  module: "leads" | "transactions",
  entry: HistoryEntry
) {
  try {
    const ref = doc(db, "activityLog", referenceId);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      // Document already exists — just push the new history entry
      await updateDoc(ref, {
        history: arrayUnion(entry),
        lastUpdated: entry.timestamp,
        lastActionBy: entry.actionBy,
        referenceName, // keep name updated in case it was edited
      });
    } else {
      // First event for this lead/transaction — create the document
      const newDoc: ActivityDocument = {
        referenceId,
        referenceName,
        module,
        history: [entry],
        lastUpdated: entry.timestamp,
        lastActionBy: entry.actionBy,
      };
      await setDoc(ref, newDoc);
    }
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
}