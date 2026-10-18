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
  /** Record counts per kind. Used for the predicted-versus-actual check. */
  counts(): Promise<Record<Kind, number>>;
  /** Everything, used only when a rule has not been confirmed yet. */
  exportAll(): Promise<Record<Kind, Rec[]>>;
  /** Changes staged since the last publish. */
  pendingPublish(): Promise<string[]>;
  publish(): Promise<{ published: number; notified: number }>;
  reset(): Promise<void>;
}

export type OpName = "delete" | "create" | "publish";

export interface Op {
  op: OpName;
  kind?: Kind;
  key?: string;
  record?: Rec;
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
