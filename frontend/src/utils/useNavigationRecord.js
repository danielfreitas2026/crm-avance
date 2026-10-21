import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { navigationKey, readNavigation, writeNavigation } from './navigation-storage';

const validId = id => (typeof id === 'string' && id.length > 0 && id.length < 200)
  || (Number.isSafeInteger(id) && id > 0);

/** Guarda apenas a identidade; o registro sempre é relido com as permissões atuais. */
export function useNavigationRecord(scope, { load, ready = true, onRestore, onError, idField = 'id' } = {}) {
  const key = navigationKey(scope);
  const [state, setState] = useState(() => ({ key, record: null, id: readNavigation(key, null, validId) }));
  const restore = useEffectEvent(async id => {
    const record = await load(id);
    if (!record) throw new Error('O registro aberto anteriormente não está mais disponível.');
    return record;
  });
  const restored = useEffectEvent(record => onRestore?.(record));
  const failed = useEffectEvent(error => onError?.(error));

  if (state.key !== key) {
    setState({ key, record: null, id: readNavigation(key, null, validId) });
  }

  useEffect(() => {
    if (!ready || !state.id || state.record || state.key !== key) return undefined;
    let active = true;
    restore(state.id).then(record => {
      if (!active) return;
      setState(current => ({ ...current, record, id: null }));
      restored(record);
    }).catch(error => {
      if (!active) return;
      writeNavigation(key, null);
      setState(current => ({ ...current, id: null }));
      failed(error);
    });
    return () => { active = false; };
  }, [key, ready, state.id, state.record, state.key]);

  const setRecord = useCallback(update => {
    setState(current => {
      const record = typeof update === 'function' ? update(current.record) : update;
      if (typeof update === 'function' && !record && !current.record && current.id) return current;
      const id = idField.split('.').reduce((value, field) => value?.[field], record);
      writeNavigation(key, validId(id) ? id : null);
      return { key, record, id: null };
    });
  }, [key, idField]);
  return [state.key === key ? state.record : null, setRecord];
}
