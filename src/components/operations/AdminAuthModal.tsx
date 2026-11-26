import React, { useId, useState, useEffect } from 'react';
import { Lock, ShieldCheck, Mail, KeyRound, User, AlertCircle, X } from 'lucide-react';
import { api } from '../../lib/api';
import { adminRecoveryMessage, adminRotationMessage, adminSignInFailure, adminStatusFailure, type AdminSetupState } from '../../lib/adminAccessStatus';

type AdminModalUser = { id: string; name: string; rotationRecommended?: boolean };

interface AdminAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (user: any) => void;
}

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticated,
}) => {
  const formId = useId();
  const [setupState, setSetupState] = useState<AdminSetupState | null>(null);
  const isSetup = setupState === 'open';
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [rotationUser, setRotationUser] = useState<AdminModalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [setupToken, setSetupToken] = useState('');

  const finishAuthentication = (user: AdminModalUser) => {
    if (user.rotationRecommended === true) {
      setRotationUser(user);
    } else {
      onAuthenticated(user);
      onClose();
    }
  };

  useEffect(() => {
    setLoading(true); setSetupState(null); setError(null); setRotationUser(null);
    setSetupToken(''); setPassword(''); setConfirmPassword('');
    if (!isOpen) return;
    const controller = new AbortController();
    void api.getAuthStatus(controller.signal).then(status => {
      if (controller.signal.aborted) return;
      setSetupState(status.setupState);
      if (status.setupState === 'closed' && status.isAuthenticated && status.user) finishAuthentication(status.user);
    }).catch(failure => {
      if (controller.signal.aborted) return;
      const status = adminStatusFailure(failure);
      setSetupState(status.state); setError(status.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isOpen, statusAttempt]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || (setupState !== 'closed' && !isSetup)) return;
    setError(null);
    setSubmitting(true);

    try {
      if (isSetup) {
        if (!email.trim() || !email.includes('@')) {
          throw new Error('Ingresa un correo electrónico corporativo válido.');
        }
        if (!name.trim()) {
          throw new Error('Ingresa el nombre del administrador.');
        }
        if (password.length < 8) {
          throw new Error('La contraseña debe tener al menos 8 caracteres.');
        }
        if (password !== confirmPassword) {
          throw new Error('Las contraseñas no coinciden.');
        }

        if (!setupToken.trim()) throw new Error('Ingresa el código de instalación configurado en el servidor.');

        const res = await api.setupMasterAdmin({
          email: email.trim(),
          password,
          name: name.trim(),
        }, setupToken.trim());
        finishAuthentication(res.user);
      } else {
        if (!email.trim() || !password) {
          throw new Error('Ingresa tu correo y contraseña.');
        }
        const res = await api.loginAdmin(email.trim(), password);
        finishAuthentication(res.user);
      }
    } catch (failure) {
      const status = await adminSignInFailure(failure, setupState, async () => (await api.getAuthStatus()).setupState);
      setSetupState(status.state); setError(status.message);
      if (status.state !== setupState) { setSetupToken(''); setPassword(''); setConfirmPassword(''); }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white relative">
          <button
            onClick={onClose}
            aria-label="Cerrar acceso administrativo"
            className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-500">
              <ShieldCheck className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">
                {isSetup ? 'Configurar Administrador Maestro' : 'Acceso Administrativo Seguro'}
              </h2>
              <p className="text-xs text-slate-400">
                {isSetup
                  ? 'Usa el correo autorizado y el código de instalación para crear la primera cuenta.'
                  : setupState === 'closed' && !rotationUser ? 'Ingresa con tu cuenta administrativa.' : null}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
              <div className="w-8 h-8 border-3 border-red-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-semibold">Verificando seguridad del servidor...</p>
            </div>
          ) : rotationUser ? (
            <div className="space-y-4">
              <p role="status">{adminRotationMessage}</p>
              <button type="button" className="font-bold text-red-700" onClick={() => { onAuthenticated(rotationUser); onClose(); }}>Continuar</button>
            </div>
          ) : setupState === 'recovery-required' || !setupState ? (
            <div className="space-y-4">
              <p role="alert">{setupState === 'recovery-required' ? adminRecoveryMessage : error}</p>
              <button type="button" className="font-bold text-red-700" onClick={() => setStatusAttempt(value => value + 1)}>Volver a comprobar</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-2xl flex items-start gap-2.5 text-xs">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {isSetup && (
                <div>
                  <label htmlFor={formId + '-name'} className="block text-xs font-bold text-slate-700 mb-1.5">
                    Nombre completo del Administrador
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      id={formId + '-name'}
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      autoComplete="name"
                      required
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white font-medium"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor={formId + '-email'} className="block text-xs font-bold text-slate-700 mb-1.5">
                  Correo Electrónico
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    id={formId + '-email'}
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="username"
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white font-medium"
                  />
                </div>
              </div>

              <div>
                <label htmlFor={formId + '-password'} className="block text-xs font-bold text-slate-700 mb-1.5">
                  Contraseña {isSetup && <span className="text-slate-400 font-normal">(mínimo 8 caracteres)</span>}
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    id={formId + '-password'}
                    type="password"
                    autoComplete={isSetup ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white font-medium"
                  />
                </div>
              </div>

              {isSetup && (
                <div>
                  <label htmlFor={formId + '-confirm'} className="block text-xs font-bold text-slate-700 mb-1.5">
                    Confirmar Contraseña
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      id={formId + '-confirm'}
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white font-medium"
                    />
                  </div>
                </div>
              )}

              {isSetup && (
                <label className="block text-xs font-bold text-slate-700">
                  Código de instalación
                  <input
                    type="password"
                    autoComplete="off"
                    value={setupToken}
                    onChange={e => setSetupToken(e.target.value)}
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </label>
              )}

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {submitting && (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  )}
                  <span>{isSetup ? 'Crear Administrador Maestro' : 'Iniciar Sesión'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
