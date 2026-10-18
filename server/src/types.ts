// Shared types. The adapter interface mirrors contract.md (with `kind` added so one adapter can serve several record kinds).

export type Kind = string;

export interface Rec {
  key: string;
  [field: string]: unknown;
}

export interface Adapter {
  kinds(): Kind[];
  read(kind: Kind, key: string): Promise<Rec | null>;
  list(kind: Kind, filter?: Record<string, unknown>): Promise<Rec[]>;
  create(kind: Kind, record: Rec): Promise<void>;
  delete(kind: Kind, key: string): Promise<void>;
  /** Change fields on an existing record. Optional: not every system supports edits. */
  update?(kind: Kind, key: string, patch: Record<string, unknown>): Promise<void>;
  /** Optional: put an agent's values in the form the system stores them in (17 -> "17", "Year 10" -> "10"). */
  normalize?(kind: Kind, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Optional: problems with a proposed patch (wrong type, not an option, out of range). Empty means fine. */
  validate?(kind: Kind, key: string, patch: Record<string, unknown>): Promise<string[]>;
  /** Record counts per kind. Used for the predicted-versus-actual check. */
  counts(forKind?: Kind): Promise<Record<Kind, number>>;
  /** Everything, used only when a rule has not been confirmed yet. */
  exportAll(forKind?: Kind): Promise<Record<Kind, Rec[]>>;
  /** Changes staged since the last publish. */
  pendingPublish(): Promise<string[]>;
  publish(): Promise<{ published: number; notified: number }>;
  reset(): Promise<void>;
}

export type OpName = "delete" | "create" | "update" | "publish";

export interface Op {
  op: OpName;
  kind?: Kind;
  key?: string;
  record?: Rec;
  /** For update: the fields to change. */
  patch?: Record<string, unknown>;
}

export type Delta = Record<Kind, number>;

export interface Snapshotted {
  kind: Kind;
  record: Rec;
}

export type PlanStatus = "previewed" | "awaiting_approval" | "approved" | "committed" | "stale" | "expired" | "rejected";

export interface Plan {
  id: string;
  op: Op;
  createdAt: number;
  expiresAt: number;
  status: PlanStatus;
  subject: Rec | null;
  dependents: Snapshotted[];
  diff: string[];
  expectedDelta: Delta;
  needsApproval: boolean;
  reasons: string[];
  hash: string;
  confirmed: boolean;
  asOfMs: number;
  /** Set when the owner's standing delegation, not a per-item approval, lets this plan commit. */
  delegatedBy?: string;
}

export interface Refusal {
  status: "refused";
  error: string;
  detail: string;
  next: string[];
  [extra: string]: unknown;
}

export type ReceiptStatus = "done" | "done_with_surprise" | "failed" | "undone";

export interface Receipt {
  id: string;
  planId: string;
  op: Op;
  at: number;
  status: ReceiptStatus;
  verified: Record<string, unknown>;
  snapshot: Snapshotted[];
  undoUntil: number;
  surprise?: { kind: Kind; delta: number }[];
  /** Who authorized it: 'owner approval' or the delegation id. */
  authority?: string;
}

export interface Mandate {
  maxDeletesPerDay: number;
  planTtlMs: number;
  undoWindowMs: number;
}

export interface Escalation {
  id: string;
  reason: string;
  at: number;
  status: "open" | "resolved";
}
