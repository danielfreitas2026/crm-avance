
/**
 * Renderiza um painel simples com corpo padronizado.
 */
function Card({ children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-body">
        {children}
      </div>
    </section>
  );
}

export default Card;
