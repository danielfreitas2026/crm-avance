import { beforeEach } from 'vitest';
import { clearNavigation } from '../utils/navigation-storage';

beforeEach(() => clearNavigation());

import '@testing-library/jest-dom/vitest';

// jsdom não implementa o ciclo de abertura/fechamento de <dialog>.
// A contenção nativa de foco é validada no navegador, não simulada aqui.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
}
