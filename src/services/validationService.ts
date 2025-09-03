import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { getZodEnhancedRegistry } from './toolRegistry.zod';
import { ZodError, ZodTypeAny } from 'zod';

interface ValidatorEntry { validate: (data: unknown)=>boolean; errors: ErrorObject[] | null | undefined }
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
try {
  if(!ajv.getSchema('https://json-schema.org/draft-07/schema')) ajv.addMetaSchema(draft7MetaSchema, 'https://json-schema.org/draft-07/schema');
} catch (e) {
  // ignore meta-schema registration errors (non-fatal)
}
const cache = new Map<string, ValidatorEntry | null>();

// Composite validator prefers Zod (when present) then falls back to Ajv JSON Schema.
interface AjvLikeValidateFn {
  (data: unknown): boolean;
  errors?: ErrorObject[];
}
interface CompositeValidator extends ValidatorEntry { zod?: ZodTypeAny; ajvFn?: AjvLikeValidateFn }

function buildValidator(method: string): ValidatorEntry | null {
  try {
    const reg = getZodEnhancedRegistry().find(t => t.name === method);
    if(!reg) return null;
  const compiled = ajv.compile(reg.inputSchema as object) as AjvLikeValidateFn;
    if(reg.zodSchema){
      const z = reg.zodSchema as ZodTypeAny;
      const v: CompositeValidator = {
        validate: (d: unknown) => {
          try { z.parse(d ?? {}); return true; } catch(e){
            if(e instanceof ZodError){
              // Map Zod issues into Ajv-like errors for uniform consumption
              compiled.errors = e.issues.map(issue => ({
                instancePath: issue.path.length ? '/' + issue.path.join('/') : '',
                keyword: issue.code as string,
                message: issue.message,
                params: { issue },
                schemaPath: '#'
              })) as ErrorObject[];
              return false;
            }
            return false;
          }
        },
        errors: null,
        zod: z,
        ajvFn: compiled
      } as CompositeValidator;
      return v;
    }
    return { validate: (d: unknown) => compiled(d), errors: null } as unknown as ValidatorEntry;
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
