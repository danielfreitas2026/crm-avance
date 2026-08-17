
/**
 * Renderiza botao.
 */
function Botao({
  title,
  type = 'button',
  variant = 'primary',
  carregando = false,
  disabled = false,
  onClick
}) {
  const className = variant === 'primary' ? 'btn btn-primary' : 'btn';

  return (
    <button
      type={type}
      className={className}
      disabled={disabled || carregando}
      onClick={onClick}
    >
      {carregando ? 'Carregando...' : title}
    </button>
  );
}

export default Botao;
