export type ToolKind = 'semgrep' | 'vanta' | 'harness';

export type Severity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info'
  | 'unknown';

export interface Location {
  file?: string;
  line?: number;
  column?: number;
  url?: string; // deep link to file/line (optional)
  snippet?: string; // field for source code snippet
}

// ---------- Base (common) ----------
export interface FindingBase {
  id: string;
  tool: ToolKind;
  ruleId: string;
  title?: string;
  message: string;
  severity: Severity;
  location?: Location;
  fingerprints?: Record<string, string>;
  tags?: string[];
  createdAt?: string;
  raw?: unknown;

  aiExplanation?: string; // short plain-language explanation
  aiRemediation?: string | string[]; // step-by-step fix or patch guidance
}

// ---------- Semgrep ----------
export interface SemgrepFinding extends FindingBase {
  tool: 'semgrep';
  ruleSeverity?: string;
  ruleShortId?: string;
  cwe?: string[];
}

// ---------- Vanta (placeholder) ----------
export interface VantaFinding extends FindingBase {
  tool: 'vanta';
  // add vanta-specific fields later
}

// ---------- Harness (placeholder) ----------
export interface HarnessFinding extends FindingBase {
  tool: 'harness';
  // add harness-specific fields later
}

// Union for listing everything together
export type Finding = SemgrepFinding | VantaFinding | HarnessFinding;
