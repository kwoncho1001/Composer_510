export type NoteType = 'Domain' | 'Module' | 'Logic' | 'Snapshot';
export type NoteStatus = 'Planned' | 'Done' | 'Conflict' | 'Todo' | 'In Progress';
export type NotePriority = '1st' | '2nd' | '3rd' | 'Done' | 'High' | 'Medium' | 'Low';
export type LensType = 'Feature' | 'Snapshot';

export interface ConflictDetail {
  aspect: string;
  design: string;
  code: string;
  impact: string;
}

export interface ConflictDetails {
  summary: string;
  differences: ConflictDetail[];
}

export interface StrategyPillars {
  painPoint: string;
  targetAudience: string;
  solutionPromise: string;
}

export interface StrategyPillarOption extends StrategyPillars {
  id: string;
  selected: boolean;
}

export interface DomainCandidate {
  id: string;
  title: string;
  summary: string;
  painPoint: string;
  targetAudience: string;
  solutionPromise: string;
  boundaries: string;
  kpis: string;
  glossary: string;
  coveredPtsIds: string[];
  selected: boolean;
}

export interface Project extends Partial<StrategyPillars> {
  id: string;
  name: string;
  repoUrl: string;
  uid: string;
  createdAt: any; // Firestore Timestamp
}

export interface ProactiveNudge {
  id: string;
  nudgeType: string;
  track: 'Involution' | 'Evolution';
  context: string;
  question: string;
  hypothesis: string;
  actionPrompt: string;
}

export interface MindMapNode {
  id: string;
  label: string;
  type: 'core' | 'feature' | 'technical' | 'market';
  description?: string;
  children?: MindMapNode[];
}

export interface MindMap {
  nodes: MindMapNode[];
  summary: string;
}

export interface Note extends Partial<StrategyPillars> {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  body: string;
  noteType: NoteType;
  status: NoteStatus;
  priority: NotePriority;
  lastUpdated: any; // Firestore Timestamp
  parentNoteIds: string[];
  childNoteIds: string[];
  
  // Domain specific
  vision?: string;
  boundaries?: string;
  stakeholders?: string;
  kpis?: string;
  glossary?: string;
  
  // Module specific
  uxGoals?: string;
  requirements?: string;
  userJourney?: string;
  ia?: string;
  
  // Logic specific
  businessRules?: string;
  constraints?: string;
  ioMapping?: string;
  edgeCases?: string;
  
  // Snapshot specific
  technicalRole?: string;
  implementation?: string;
  dependencies?: string;
  executionFlow?: string;

  originPath?: string;
  startLine?: number;
  endLine?: number;
  codeSnippet?: string;
  sha?: string;
  contentHash?: string;
  embedding?: number[];
  embeddingHash?: string;
  embeddingModel?: string;
  lastEmbeddedAt?: any; // Firestore Timestamp
  lens?: LensType;
  uid: string;
  createdAt: any; // Firestore Timestamp
  conflictDetails?: ConflictDetails;
}

export interface SyncLedger {
  id: string;
  projectId: string;
  repoUrl: string;
  fileShaMap: Record<string, string>;
  lastSyncedAt: any; // Firestore Timestamp
  uid: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: any;
}
