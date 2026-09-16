import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import logo from '../../assets/LogoClaraSemFundo.png';
import './PublicInfoPage.css';

const GOOGLE_POLICY_URL = 'https://developers.google.com/terms/api-services-user-data-policy';
const COMPANY_SITE_URL = 'https://avancevip.net.br';

const PAGE_META = {
  integracao: {
    title: 'Integração Gmail | Pós-venda Avance VIP',
    description: 'Informações sobre a integração interna entre o Gmail corporativo e o CRM de pós-venda da Avance VIP.'
  },
  privacidade: {
    title: 'Política de Privacidade | Pós-venda Avance VIP',
    description: 'Política de privacidade da integração interna do Gmail com o CRM de pós-venda da Avance VIP.'
  },
  termos: {
    title: 'Termos de Uso | Pós-venda Avance VIP',
    description: 'Termos de uso do CRM interno de pós-venda da Avance VIP.'
  }
};

function PageMetadata({ page }) {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector('meta[name="description"]');
    const previousDescription = description?.getAttribute('content') ?? null;

    document.title = PAGE_META[page].title;
    if (description) description.setAttribute('content', PAGE_META[page].description);

    return () => {
      document.title = previousTitle;
      if (description && previousDescription !== null) description.setAttribute('content', previousDescription);
    };
  }, [page]);

  return null;
}

function PublicHeader() {
  return (
    <header className="public-info__header">
      <Link to="/login" aria-label="Voltar para o login do Pós-venda Avance VIP">
        <img src={logo} alt="Avance VIP" />
      </Link>
      <nav aria-label="Informações públicas">
        <Link to="/integracao-gmail">Integração Gmail</Link>
        <Link to="/privacidade">Privacidade</Link>
        <Link to="/termos">Termos</Link>
      </nav>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="public-info__footer">
      <span>Avance VIP · Sistema interno de pós-venda</span>
      <a href={COMPANY_SITE_URL} target="_blank" rel="noreferrer">Site institucional</a>
      <Link to="/login">Acessar o CRM</Link>
    </footer>
  );
}

function IntegrationContent() {
  return (
    <>
      <span className="public-info__eyebrow">Aplicativo interno</span>
      <h1>Integração Gmail do Pós-venda Avance VIP</h1>
      <p className="public-info__lead">
        Esta integração conecta uma caixa corporativa dedicada ao CRM para registrar e tratar retornos operacionais de pós-venda.
      </p>

      <section>
        <h2>Como funciona</h2>
        <p>
          O sistema consulta mensagens recebidas da operadora, identifica o pedido relacionado e aplica as regras internas do fluxo de pós-venda. Casos que exigem análise humana ficam disponíveis aos usuários autorizados do CRM.
        </p>
      </section>

      <section>
        <h2>Acesso ao Gmail</h2>
        <p>
          O aplicativo solicita exclusivamente o escopo <strong>Gmail somente leitura</strong>. Ele não envia, altera, marca nem exclui mensagens na conta conectada.
        </p>
      </section>

      <section>
        <h2>Quem pode usar</h2>
        <p>
          O aplicativo é restrito à organização Google Workspace da Avance VIP e a uma caixa corporativa administrada pela empresa. Clientes e terceiros não podem conectar contas pessoais.
        </p>
      </section>

      <section>
        <h2>Suporte e privacidade</h2>
        <p>
          Dúvidas, solicitações de privacidade e pedidos de revogação devem ser enviados pelo canal de contato publicado no <a href={COMPANY_SITE_URL} target="_blank" rel="noreferrer">site institucional da Avance VIP</a>.
        </p>
        <p>Consulte também nossa <Link to="/privacidade">Política de Privacidade</Link> e os <Link to="/termos">Termos de Uso</Link>.</p>
      </section>
    </>
  );
}

function PrivacyContent() {
  return (
    <>
      <span className="public-info__eyebrow">Última atualização: 16 de setembro de 2026</span>
      <h1>Política de Privacidade</h1>
      <p className="public-info__lead">
        Esta política explica como a Avance VIP trata dados na integração interna entre uma caixa Gmail corporativa e seu CRM de pós-venda.
      </p>

      <section>
        <h2>Controlador e contato</h2>
        <p>
          A Avance VIP é responsável pelo tratamento descrito nesta política. Solicitações de titulares, dúvidas ou pedidos de revogação podem ser feitos pelo canal de contato publicado no <a href={COMPANY_SITE_URL} target="_blank" rel="noreferrer">site institucional</a>.
        </p>
      </section>

      <section>
        <h2>Dados tratados</h2>
        <ul>
          <li>Identificadores da mensagem e da conversa no Gmail.</li>
          <li>Remetente, assunto, data e horário de recebimento e corpo textual da mensagem.</li>
          <li>Documento, dados do pedido, destino do fluxo e mensagem da operadora extraídos do conteúdo.</li>
          <li>Status de processamento, vínculo com a venda, revisões e registros de auditoria.</li>
        </ul>
        <p>Anexos e mensagens cujo conteúdo exista somente em imagem não são processados automaticamente.</p>
      </section>

      <section>
        <h2>Finalidades e fundamento</h2>
        <p>
          Os dados são usados para identificar vendas, atualizar etapas do pós-venda, abrir ocorrências, evitar processamento duplicado, permitir revisão interna e manter a rastreabilidade das operações comerciais. O tratamento atende às atividades comerciais e operacionais legítimas da empresa e às obrigações aplicáveis à relação com clientes e parceiros.
        </p>
      </section>

      <section>
        <h2>Compartilhamento</h2>
        <p>
          Os dados ficam disponíveis somente a profissionais autorizados e aos fornecedores necessários à operação, como Google, infraestrutura de hospedagem e banco de dados. Alertas internos enviados pelo Telegram podem conter o número e nome da venda, razão social, CNPJ ou CPF e a mensagem recebida da operadora. Esses alertas permanecem sujeitos às configurações e políticas de retenção do grupo corporativo no Telegram.
        </p>
      </section>

      <section>
        <h2>Retenção e exclusão</h2>
        <p>
          O corpo textual original é removido do CRM após 12 meses. Identificadores, metadados, dados extraídos, resultados e vínculos permanecem associados ao cadastro comercial durante o prazo de retenção aplicável à venda, para auditoria e prevenção de duplicidade. Pedidos de acesso, correção, oposição ou exclusão são avaliados pelo canal de privacidade, considerando obrigações legais e a necessidade de preservar registros legítimos.
        </p>
      </section>

      <section>
        <h2>Segurança e revogação</h2>
        <p>
          O acesso ao CRM exige autenticação e permissões internas. As credenciais OAuth ficam em ambiente protegido, fora do código-fonte. A autorização do Gmail pode ser revogada pela administração da conta Google ou pela equipe responsável pelo sistema; a revogação interrompe novas coletas sem apagar automaticamente o histórico comercial já existente.
        </p>
      </section>

      <section>
        <h2>Uso de dados das APIs do Google</h2>
        <p>
          O uso e a transferência de informações recebidas das APIs do Google seguem a <a href={GOOGLE_POLICY_URL} target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, inclusive os requisitos de uso limitado.
        </p>
      </section>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <span className="public-info__eyebrow">Última atualização: 16 de setembro de 2026</span>
      <h1>Termos de Uso</h1>
      <p className="public-info__lead">
        Estes termos regulam o uso do CRM de pós-venda e de sua integração interna com o Gmail corporativo.
      </p>

      <section>
        <h2>Uso autorizado</h2>
        <p>
          O sistema é de uso exclusivo de profissionais autorizados pela Avance VIP. As credenciais são pessoais e não devem ser compartilhadas. O acesso pode ser restringido ou encerrado pela administração da empresa.
        </p>
      </section>

      <section>
        <h2>Responsabilidades do usuário</h2>
        <p>
          Usuários devem consultar e tratar as informações somente para finalidades profissionais, respeitar as permissões concedidas, conferir situações encaminhadas para revisão e comunicar acessos indevidos ou comportamentos inesperados.
        </p>
      </section>

      <section>
        <h2>Automação e disponibilidade</h2>
        <p>
          A integração auxilia atividades operacionais e pode depender da disponibilidade do Google, do Telegram e da infraestrutura contratada. Ocorrências não processadas automaticamente devem ser verificadas no painel de automações do CRM.
        </p>
      </section>

      <section>
        <h2>Dados e confidencialidade</h2>
        <p>
          Mensagens, dados comerciais e informações pessoais acessíveis no sistema são confidenciais. Seu tratamento deve observar a <Link to="/privacidade">Política de Privacidade</Link> e as normas internas da Avance VIP.
        </p>
      </section>

      <section>
        <h2>Alterações e contato</h2>
        <p>
          Estes termos podem ser atualizados para refletir mudanças legais ou operacionais. A data da versão vigente será indicada nesta página. Dúvidas devem ser encaminhadas pelo canal disponível no <a href={COMPANY_SITE_URL} target="_blank" rel="noreferrer">site institucional</a>.
        </p>
      </section>
    </>
  );
}

const CONTENT = {
  integracao: IntegrationContent,
  privacidade: PrivacyContent,
  termos: TermsContent
};

function PublicInfoPage({ page }) {
  const Content = CONTENT[page];

  return (
    <div className="public-info">
      <PageMetadata page={page} />
      <PublicHeader />
      <main className="public-info__main">
        <article><Content /></article>
      </main>
      <PublicFooter />
    </div>
  );
}

export default PublicInfoPage;
