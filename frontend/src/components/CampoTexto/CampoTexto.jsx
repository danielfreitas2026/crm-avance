
/**
 * Renderiza um campo de texto controlado com label opcional.
 */
function CampoTexto({
  label,
  type = 'text',
  name,
  value,
  placeholder,
  onChange,
  required = false
}) {
  return (
    <div className="form-field">
      {label && <label>{label}</label>}

      <input
        type={type}
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        required={required}
      />
    </div>
  );
}

export default CampoTexto;
