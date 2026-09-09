import { Navigate, Route, Routes } from 'react-router-dom';

import LoginPage from '../pages/LoginPage/LoginPage';
import PerfilPage from '../pages/PerfilPage/PerfilPage';
import Usuarios from '../pages/Usuarios/Usuarios';
import CadastroUsuario from '../pages/CadastroUsuario/CadastroUsuario';
import FunilPage from '../pages/FunilPage/FunilPage';
import FunilAutomacoesPage from '../pages/FunilPage/FunilAutomacoesPage';
import DashboardPage from '../pages/DashboardPage/DashboardPage';
import RelatoriosPage from '../pages/RelatoriosPage/RelatoriosPage';
import EditarPerfilPage from '../pages/EditarPerfilPage/EditarPerfilPage';
import EditarUsuarioPage from '../pages/EditarUsuarioPage/EditarUsuarioPage';
import HistoricoPage from '../pages/HistoricoPage/HistoricoPage';
import HistoricoLixeiraPage from '../pages/HistoricoPage/HistoricoLixeiraPage';
import ConfiguracoesPage from '../pages/ConfiguracoesPage/ConfiguracoesPage';
import VendasPage from '../pages/VendasPage/VendasPage';
import VendasLixeiraPage from '../pages/VendasPage/VendasLixeiraPage';
import VendasAprovacoesPage from '../pages/VendasPage/VendasAprovacoesPage';
import RetornosPage from '../pages/RetornosPage/RetornosPage';
import Clientes from '../pages/Clientes/Clientes';
import ClienteFormPage from '../pages/Clientes/ClienteFormPage';
import ClientesSecretosPage from '../pages/Clientes/ClientesSecretosPage';
import ClientesLixeiraPage from '../pages/Clientes/ClientesLixeiraPage';
import AdminLeadsPage from '../pages/AdminLeadsPage/AdminLeadsPage';
import CruzarVendasPage from '../pages/CruzarVendasPage/CruzarVendasPage';
import CnpjImportacaoPage from '../pages/CnpjImportacaoPage/CnpjImportacaoPage';
import ClientesAntigosPage from '../pages/ClientesAntigosPage/ClientesAntigosPage';
import FuturosClientesPage from '../pages/FuturosClientesPage/FuturosClientesPage';
import FechamentoMensalPage from '../pages/FechamentoMensalPage/FechamentoMensalPage';
import MensagensPage from '../pages/MensagensPage/MensagensPage';
import AutomacoesPage from '../pages/AutomacoesPage/AutomacoesPage';
import ProblemasPage from '../pages/ProblemasPage/ProblemasPage';
import '../pages/HistoricoPage/HistoricoPage.css';

import { getUsuarioLocal, temPermissao } from '../services/auth.service';

/**
 * Processa private route conforme as regras do dominio.
 */
function PrivateRoute({ children, permission }) {
  const token = localStorage.getItem('token');
  const usuario = getUsuarioLocal();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (permission && !temPermissao(usuario, permission)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

import AdminCampanhasPage from '../pages/AdminCampanhasPage/AdminCampanhasPage';

/**
 * Processa app routes conforme as regras do dominio.
 */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
      
      <Route path="/funil" element={<PrivateRoute permission="funil_vendas"><FunilPage /></PrivateRoute>} />
      <Route path="/funil-automacoes" element={<PrivateRoute permission="funil_automacoes"><FunilAutomacoesPage /></PrivateRoute>} />

      <Route path="/vendas" element={<PrivateRoute permission={['vendas', 'vendas_ver_proprias', 'vendas_ver_todas', 'vendas_criar', 'vendas_editar', 'vendas_excluir']}><VendasPage /></PrivateRoute>} />
      <Route path="/vendas/aprovacoes" element={<PrivateRoute permission="vendas_aprovacoes_visualizar"><VendasAprovacoesPage /></PrivateRoute>} />
      <Route path="/vendas/lixeira" element={<PrivateRoute permission={['vendas_ver_proprias', 'vendas_ver_todas']}><VendasLixeiraPage /></PrivateRoute>} />

      <Route path="/login" element={<LoginPage />} />

      <Route path="/perfil" element={<PrivateRoute><PerfilPage /></PrivateRoute>} />

      <Route path="/perfil/editar" element={<PrivateRoute><EditarPerfilPage /></PrivateRoute>} />

      <Route
        path="/usuarios"
        element={<PrivateRoute permission={['crud_usuarios', 'usuarios_listar', 'usuarios_criar', 'usuarios_editar', 'usuarios_excluir', 'gerenciar_permissoes']}><Usuarios /></PrivateRoute>}
      />

      <Route
        path="/usuarios/novo"
        element={<PrivateRoute permission="usuarios_criar"><CadastroUsuario /></PrivateRoute>}
      />

      <Route
        path="/usuarios/cadastrar"
        element={<PrivateRoute permission="usuarios_criar"><CadastroUsuario /></PrivateRoute>}
      />

      <Route
        path="/usuarios/:id/editar"
        element={<PrivateRoute permission="usuarios_editar"><EditarUsuarioPage /></PrivateRoute>}
      />

      <Route
        path="/admin/campanhas"
        element={<PrivateRoute permission="gerenciar_campanhas"><AdminCampanhasPage /></PrivateRoute>}
      />
      <Route
        path="/admin/fechamento-mensal"
        element={<PrivateRoute permission="vendas_fechamento_mensal"><FechamentoMensalPage /></PrivateRoute>}
      />
      <Route
        path="/admin/leads"
        element={<PrivateRoute permission="gerenciar_leads"><AdminLeadsPage /></PrivateRoute>}
      />
      <Route
        path="/admin/cruzar-vendas"
        element={<PrivateRoute permission="vendas_cruzar"><CruzarVendasPage /></PrivateRoute>}
      />
      <Route
        path="/admin/consultar-cnpj"
        element={<PrivateRoute permission="clientes_importar_planilhas"><CnpjImportacaoPage /></PrivateRoute>}
      />

      <Route
        path="/clientes-antigos"
        element={<PrivateRoute permission={['clientes_antigos_buscar', 'clientes_antigos_ver_historico']}><ClientesAntigosPage /></PrivateRoute>}
      />

      <Route
        path="/futuros-clientes"
        element={<PrivateRoute permission={['futuros_clientes_ver', 'vendas_criar']}><FuturosClientesPage /></PrivateRoute>}
      />

      <Route path="/retornos" element={<PrivateRoute permission={['vendas_ver_proprias', 'vendas_ver_todas', 'ver_vendas_compartilhadas']}><RetornosPage /></PrivateRoute>} />
      <Route path="/dashboard" element={<Navigate to="/" replace />} />
      <Route path="/relatorios" element={<PrivateRoute permission="relatorios_visualizar"><RelatoriosPage /></PrivateRoute>} />
      <Route path="/mensagens" element={<PrivateRoute permission={['chat_usar', 'chat_visualizar_todas']}><MensagensPage /></PrivateRoute>} />
      <Route path="/automacoes" element={<PrivateRoute permission="automacoes_gerenciar"><AutomacoesPage /></PrivateRoute>} />
      <Route path="/problemas" element={<PrivateRoute permission="problemas_pos_venda_responsavel"><ProblemasPage /></PrivateRoute>} />
      <Route path="/historico" element={<PrivateRoute permission="historico_visualizar"><HistoricoPage /></PrivateRoute>} />
      <Route path="/historico/lixeira" element={<PrivateRoute permission="historico_visualizar"><HistoricoLixeiraPage /></PrivateRoute>} />
      <Route
        path="/clientes"
        element={<PrivateRoute permission={['clientes_ver_proprios', 'clientes_ver_todos', 'clientes_criar', 'clientes_importar_planilhas', 'clientes_editar', 'clientes_excluir']}><Clientes /></PrivateRoute>}
      />
      <Route
        path="/clientes-secretos"
        element={<PrivateRoute permission={['clientes_secretos_ver', 'clientes_secretos_ver_todos']}><ClientesSecretosPage /></PrivateRoute>}
      />
      <Route
        path="/clientes-secretos/novo"
        element={<PrivateRoute permission="clientes_secretos_criar"><ClienteFormPage /></PrivateRoute>}
      />
      <Route
        path="/clientes-secretos/:id/editar"
        element={<PrivateRoute permission="clientes_secretos_editar"><ClienteFormPage /></PrivateRoute>}
      />
      <Route
        path="/clientes/lixeira"
        element={<PrivateRoute permission={['clientes_ver_proprios', 'clientes_ver_todos']}><ClientesLixeiraPage /></PrivateRoute>}
      />
      <Route
        path="/clientes/novo"
        element={<PrivateRoute permission="clientes_criar"><Navigate to="/clientes?novo=1" replace /></PrivateRoute>}
      />
      <Route
        path="/clientes/:id/editar"
        element={<PrivateRoute permission="clientes_editar"><ClienteFormPage /></PrivateRoute>}
      />
      <Route
        path="/configuracoes"
        element={<PrivateRoute permission={['crud_operadoras', 'crud_links', 'crud_tipos_venda', 'crud_servicos', 'crud_regras_comissao', 'clientes_antigos_gerenciar', 'configurar_notificacoes', 'configurar_horario_acesso']}><ConfiguracoesPage /></PrivateRoute>}
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default AppRoutes;
