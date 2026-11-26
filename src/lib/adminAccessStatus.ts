export type AdminSetupState = 'open' | 'closed' | 'recovery-required';

interface StatusResponse {
  setupState?: AdminSetupState;
  isSetupRequired: boolean;
}

// Older installations can still log in. Opening setup requires explicit server authorization.
export function adminSetupState(status: StatusResponse): AdminSetupState {
  if (status.setupState === 'recovery-required') return 'recovery-required';
  if (status.setupState === 'open' && status.isSetupRequired === true) return 'open';
  if ((status.setupState === 'closed' || status.setupState === undefined) && status.isSetupRequired === false) return 'closed';
  throw new Error('No pudimos comprobar si el alta administrativa está habilitada.');
}

export class AdminRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'AdminRequestError';
  }
}

export function isAdminRecoveryRequired(error: unknown) {
  return error instanceof AdminRequestError && error.status === 503 && error.code === 'ADMIN_RECOVERY_REQUIRED';
}

export const adminStatusUnavailableMessage = 'No pudimos comprobar el acceso administrativo. Intenta de nuevo.';
export const adminRecoveryMessage = 'Contacta a la persona responsable de la instalación para recuperar el acceso administrativo con el respaldo autorizado.';
export const adminRotationMessage = 'Esta cuenta tiene una rotación de contraseña pendiente. Coordina el cambio con la persona responsable de la instalación.';

export function adminStatusFailure(error: unknown) {
  return isAdminRecoveryRequired(error)
    ? { state: 'recovery-required' as const, message: '' }
    : { state: null, message: adminStatusUnavailableMessage };
}

export async function adminSignInFailure(
  error: unknown, state: AdminSetupState | null, readState: () => Promise<AdminSetupState>,
) {
  if (isAdminRecoveryRequired(error)) return adminStatusFailure(error);
  if (state === 'open' && error instanceof AdminRequestError && (error.status === 403 || error.status === 409)) {
    try { state = await readState(); }
    catch (refreshError) { return adminStatusFailure(refreshError); }
    if (state === 'closed') return { state, message: 'El alta inicial ya se completó. Ingresa con tu cuenta.' };
    if (state === 'recovery-required') return { state, message: '' };
  }
  return { state, message: error instanceof Error ? error.message : 'No pudimos completar el acceso administrativo.' };
}
