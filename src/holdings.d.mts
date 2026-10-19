export type NameEntry = [name: string, etfCount: number];
export type Holding = {
  code: string;
  name: string;
  weight: number | null;
  count: number | null;
  marketSum: number | null;
  amount: number | null;
};
export type SortMode = 'weight' | 'amount' | 'count';
export function normalizeName(value: string): string;
export function shardForName(name: string): string;
export function findNames(names: NameEntry[], query: string, limit?: number): NameEntry[];
export function decodeRows(raw: unknown): Holding[];
export function rankRows(rows: Holding[], mode: SortMode): { ranked: Holding[]; missing: Holding[] };
export function effectiveMode(rows: Holding[], mode: SortMode): SortMode;
