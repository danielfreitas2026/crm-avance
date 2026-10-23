import { useEffect } from 'react';
import { encerrarSessaoExpirada } from '../services/api';
import { expiracaoSessaoCodigo, SESSION_EXPIRED_MESSAGE } from './sessao-codigo';

export function useExpiracaoSessaoCodigo(token) {
  useEffect(() => {
    if (!token) return;
    let timer;

    function verificar() {
      clearTimeout(timer);
      const atual = localStorage.getItem('token');
      if (!atual) {
        encerrarSessaoExpirada(null);
        return;
      }
      const expiraEm = expiracaoSessaoCodigo(atual);
      if (expiraEm === null) return;
      const restante = expiraEm - Date.now();
      if (restante <= 0) encerrarSessaoExpirada(atual);
      else timer = setTimeout(verificar, Math.min(restante, 2147483647));
    }

    function sincronizar(event) {
      if (event.storageArea !== localStorage || (event.key !== 'token' && event.key !== null)) return;
      const anteriorExpiraEm = expiracaoSessaoCodigo(event.oldValue);
      if (!localStorage.getItem('token') && anteriorExpiraEm !== null && anteriorExpiraEm <= Date.now()) {
        sessionStorage.setItem('logout_message', SESSION_EXPIRED_MESSAGE);
      }
      verificar();
    }

    verificar();
    window.addEventListener('focus', verificar);
    document.addEventListener('visibilitychange', verificar);
    window.addEventListener('storage', sincronizar);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', verificar);
      document.removeEventListener('visibilitychange', verificar);
      window.removeEventListener('storage', sincronizar);
    };
  }, [token]);
}
