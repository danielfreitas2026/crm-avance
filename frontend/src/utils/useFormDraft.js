import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook para gerenciar persistência de dados de formulários usando localStorage
 * Ideal para rascunhos de formulários que podem ser interrompidos e retomados
 * 
 * @param {string} draftKey - Chave única para o rascunho (ex: 'cliente_novo', 'venda_novo')
 * @param {Object} formData - Dados atuais do formulário
 * @param {boolean} isEditing - Se true, não persiste (para edição de registros existentes)
 * @param {number} debounceMs - Tempo de debounce para salvar (padrão: 500ms)
 * @returns {Object} { loadDraft, clearDraft, hasDraft }
 */
export function useFormDraft(draftKey, formData, isEditing = false, debounceMs = 500) {
  const debounceTimerRef = useRef(null);
  const lastSavedRef = useRef(null);

  // Salva o rascunho no localStorage com debounce
  const saveDraft = useCallback(() => {
    if (isEditing || !draftKey || !formData) return;

    // Evita salvar se nada mudou
    if (JSON.stringify(lastSavedRef.current) === JSON.stringify(formData)) {
      return;
    }

    try {
      localStorage.setItem(`form_draft_${draftKey}`, JSON.stringify(formData));
      lastSavedRef.current = formData;
    } catch (error) {
      // localStorage pode estar cheio ou indisponível
      console.error(`Erro ao salvar rascunho ${draftKey}:`, error);
    }
  }, [draftKey, formData, isEditing]);

  // Effect para debounce do salvamento
  useEffect(() => {
    if (isEditing || !draftKey) return;

    // Limpa o timer anterior
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Define novo timer
    debounceTimerRef.current = setTimeout(() => {
      saveDraft();
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [formData, isEditing, draftKey, debounceMs, saveDraft]);

  // Carrega o rascunho do localStorage
  const loadDraft = useCallback(() => {
    if (!draftKey) return null;

    try {
      const draft = localStorage.getItem(`form_draft_${draftKey}`);
      return draft ? JSON.parse(draft) : null;
    } catch (error) {
      console.error(`Erro ao carregar rascunho ${draftKey}:`, error);
      return null;
    }
  }, [draftKey]);

  // Limpa o rascunho do localStorage
  const clearDraft = useCallback(() => {
    if (!draftKey) return;

    try {
      localStorage.removeItem(`form_draft_${draftKey}`);
      lastSavedRef.current = null;
    } catch (error) {
      console.error(`Erro ao limpar rascunho ${draftKey}:`, error);
    }
  }, [draftKey]);

  // Verifica se existe um rascunho salvo
  const hasDraft = useCallback(() => {
    if (!draftKey) return false;

    try {
      return localStorage.getItem(`form_draft_${draftKey}`) !== null;
    } catch {
      return false;
    }
  }, [draftKey]);

  return {
    loadDraft,
    clearDraft,
    hasDraft
  };
}
