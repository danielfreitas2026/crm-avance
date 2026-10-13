import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getUsuarioLocal } from '../services/auth.service';

function AdminRoute({ children }) {
  const [usuario, setUsuario] = useState(() => getUsuarioLocal());
  useEffect(() => {
    const atualizar = () => setUsuario(getUsuarioLocal());
    window.addEventListener('auth:usuario-atualizado', atualizar);
    window.addEventListener('auth:sessao-encerrada', atualizar);
    window.addEventListener('storage', atualizar);
    return () => {
      window.removeEventListener('auth:usuario-atualizado', atualizar);
      window.removeEventListener('auth:sessao-encerrada', atualizar);
      window.removeEventListener('storage', atualizar);
    };
  }, []);
  if (usuario?.role?.nome !== 'admin' || ![true, 1].includes(usuario?.ativo)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default AdminRoute;
