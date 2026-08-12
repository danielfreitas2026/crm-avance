import { parseUtcDateTime } from '../../utils/datetime';

export function chaveDataMensagem(valor) {
  const data = parseUtcDateTime(valor);
  if (!data) return '';
  const pad = numero => String(numero).padStart(2, '0');
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;
}

export function rotuloDataMensagem(valor, agora = new Date()) {
  const data = parseUtcDateTime(valor);
  if (!data) return '';
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const inicioData = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  const diferencaDias = Math.round((inicioHoje - inicioData) / 86400000);
  if (diferencaDias === 0) return 'Hoje';
  if (diferencaDias === 1) return 'Ontem';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
