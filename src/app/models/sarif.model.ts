export interface SarifLog {
  runs: SarifRun[];
}
export interface SarifRun {
  tool: { driver: { name: string; rules?: SarifRule[] } };
  results?: SarifResult[];
}
export interface SarifRule {
  id: string;
  name?: string;
  shortDescription?: { text: string };
  fullDescription?: { text: string };
  help?: { text?: string; markdown?: string };
}
export interface SarifResult {
  ruleId?: string;
  level?: 'none' | 'note' | 'warning' | 'error';
  message: { text?: string; markdown?: string };
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: { startLine?: number; startColumn?: number };
    };
  }>;
}
