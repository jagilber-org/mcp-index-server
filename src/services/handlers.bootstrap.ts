import { registerHandler } from '../server/registry';
import { requestBootstrapToken, finalizeBootstrapToken, getBootstrapStatus, mutationGatedReason } from './bootstrapGating';

registerHandler('bootstrap/request', (p:{ rationale?: string }) => {
  const reason = mutationGatedReason();
  return { status: getBootstrapStatus(), gatedReason: reason, ...requestBootstrapToken(p?.rationale) };
});

registerHandler('bootstrap/confirmFinalize', (p:{ token:string }) => {
  if(!p || typeof p.token !== 'string' || !p.token.trim()) return { error:'missing_token' };
  const result = finalizeBootstrapToken(p.token.trim());
  return { result, status: getBootstrapStatus() };
});

registerHandler('bootstrap/status', () => {
  return { status: getBootstrapStatus(), gatedReason: mutationGatedReason() };
});
