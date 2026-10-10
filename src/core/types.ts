export interface Sentence {
  /** Stable within a snapshot, e.g. "a1b2c3-4.2" (passage id + sentence number). */
  id: string;
  text: string;
}

export interface Passage {
  id: string;
  url: string;
  pageTitle: string;
  heading: string;
  sentences: Sentence[];
}

export interface Page {
  url: string;
  title: string;
  fetchedAt: string;
  /** sha256 of the normalised page text, used to detect changes between snapshots. */
  hash: string;
  passages: Passage[];
}

export interface Snapshot {
  id: string;
  createdAt: string;
  source: string;
  pages: Page[];
}

export interface SourceConfig {
  name: string;
  startUrls: string[];
  allowPrefixes: string[];
  maxPages: number;
  delayMs: number;
  userAgent: string;
}

/** A sentence quoted back to the user as evidence. */
export interface Evidence {
  sentenceId: string;
  text: string;
  url: string;
  pageTitle: string;
  heading: string;
  deepLink: string;
}

export type PointStatus = 'verified' | 'rejected';

export interface CheckedPoint {
  text: string;
  citations: string[];
  status: PointStatus;
  /** Why a point was rejected; empty when verified. */
  reasons: string[];
  /** Share of the point's content words found in the cited sentences (0 to 1). */
  support: number;
}

export interface AnswerResult {
  question: string;
  mode: 'llm' | 'extractive';
  answerable: boolean;
  points: CheckedPoint[];
  rejected: CheckedPoint[];
  evidence: Record<string, Evidence>;
  retrieved: { passageId: string; url: string; pageTitle: string; heading: string; score: number }[];
  note?: string;
  snapshotId: string;
}

export type UpdateKind = 'new' | 'changed' | 'removed';

export interface GuidanceUpdate {
  id: string;
  kind: UpdateKind;
  url: string;
  title: string;
  fromSnapshot: string | null;
  toSnapshot: string;
  detectedAt: string;
  added: Sentence[];
  removed: Sentence[];
  summary?: {
    points: CheckedPoint[];
    rejected: CheckedPoint[];
  };
}
