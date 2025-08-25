import Ajv, { ErrorObject } from 'ajv';
import { getToolRegistry } from './toolRegistry';

interface ValidatorEntry { validate: (data: unknown)=>boolean; errors: ErrorObject[] | null | undefined }
const ajv = new Ajv({ allErrors: true, strict: false });
const cache = new Map<string, ValidatorEntry | null>();

function buildValidator(method: string): ValidatorEntry | null {
  try {
    const reg = getToolRegistry().find(t => t.name === method);
    if(!reg) return null;
    const validate = ajv.compile(reg.inputSchema as object) as (d: unknown)=>boolean & { errors?: ErrorObject[] };
    return { validate: (d: unknown) => validate(d), errors: null } as unknown as ValidatorEntry;
  } catch { return null; }
}

export function validateParams(method: string, params: unknown): { ok: true } | { ok: false; errors: ErrorObject[] } {
  let entry = cache.get(method);
  if(entry === undefined){ entry = buildValidator(method); cache.set(method, entry); }
  if(!entry) return { ok: true }; // no schema => accept
  const ok = entry.validate(params === undefined ? {} : params);
  if(ok) return { ok: true };
  const v: unknown = entry.validate;
  const errors = (v && typeof v === 'object' && 'errors' in (v as Record<string,unknown>)) ? (v as { errors?: ErrorObject[] }).errors || [] : [];
  return { ok: false, errors };
}

export function clearValidationCache(){ cache.clear(); }
