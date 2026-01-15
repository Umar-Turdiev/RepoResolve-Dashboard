import type { Finding, SemgrepFinding, Severity } from './finding.model';

/** Normalize to your 6-level severity scale */
function toSeverity(s?: string): Severity {
  const v = (s || '').toLowerCase();
  if (v === 'critical' || v === 'blocker') return 'critical';
  if (v === 'high' || v === 'error') return 'high';
  if (v === 'medium' || v === 'warning') return 'medium';
  if (v === 'low' || v === 'note' || v === 'info') return 'low';
  return 'unknown';
}

/** Simple stable hash for UI keys */
function hashId(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function msgText(msg: any): string {
  return (msg?.text || msg?.markdown || msg || '').toString().trim();
}

/** Detect if payload looks like SARIF */
export function isSarif(payload: any): boolean {
  return (
    !!payload &&
    Array.isArray(payload?.runs) &&
    Array.isArray(payload?.runs[0]?.results)
  );
}

/** Main: map Semgrep SARIF → Finding[] */
export function mapSemgrepSarifToFindings(
  sarif: any,
  ctx?: { repo?: string; createdAt?: string }
): Finding[] {
  const run = sarif?.runs?.[0] || {};
  const results: any[] = run?.results || [];
  const driver = run?.tool?.driver;
  const driverRules: Record<string, any> = (driver?.rules || []).reduce(
    (m: any, r: any) => {
      if (r?.id) m[r.id] = r;
      return m;
    },
    {}
  );

  return results.map((r: any, idx: number): SemgrepFinding => {
    const firstLoc = r?.locations?.[0]?.physicalLocation;
    const file = firstLoc?.artifactLocation?.uri || '';
    const region = firstLoc?.region || {};
    const line = Number(region?.startLine) || undefined;
    const col = Number(region?.startColumn) || undefined;
    const snippet = region?.snippet?.text || undefined;

    const ruleId: string = r?.ruleId || 'rule';
    const driverRule = driverRules[ruleId];
    const title =
      driverRule?.shortDescription?.text || driverRule?.name || ruleId;

    // severity could be on result.level, or in properties, or in rule
    const sevRaw =
      (r?.level as string) ||
      (r?.properties?.severity as string) ||
      (driverRule?.properties?.severity as string) ||
      (driverRule?.defaultConfiguration?.level as string) ||
      undefined;

    const message = msgText(r?.message);
    const idBase = `${ruleId}|${file}|${line || ''}|${message.slice(0, 140)}`;
    const id = hashId(idBase) + '-' + idx.toString(36);

    return {
      id,
      tool: 'semgrep',
      ruleId,
      title,
      message,
      severity: toSeverity(sevRaw),
      location: {
        file: file || undefined,
        line,
        column: col,
        snippet,
      },
      fingerprints: r?.fingerprints || undefined,
      tags: r?.properties?.tags || driverRule?.properties?.tags || undefined,
      createdAt: ctx?.createdAt,
      raw: r,

      // semgrep-specific extras
      ruleSeverity: typeof sevRaw === 'string' ? sevRaw : undefined,
      ruleShortId: ruleId.split('.').pop(),
      cwe: (r?.properties?.cwe || driverRule?.properties?.cwe) ?? undefined,
    };
  });
}
