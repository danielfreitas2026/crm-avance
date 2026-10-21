import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigationKey, readNavigation, sameNavigationType, writeNavigation } from './navigation-storage';

/** Persiste somente os campos de navegação explicitamente adotados pela tela. */
export function useNavigationState(scope, initialValue, { allowed, validate, preferInitial = false } = {}) {
  const key = navigationKey(scope);
  const initial = typeof initialValue === 'function' ? initialValue() : initialValue;
  const valid = value => (validate ? validate(value) : sameNavigationType(value, initial))
    && (!allowed || allowed.includes(value));
  const [stored, setStored] = useState(() => ({ key, value: preferInitial ? initial : readNavigation(key, initial, valid) }));
  let current = stored;
  if (stored.key !== key) {
    current = { key, value: preferInitial ? initial : readNavigation(key, initial, valid) };
    setStored(current);
  }
  const setValue = useCallback(update => {
    setStored(previous => {
      const value = typeof update === 'function' ? update(previous.value) : update;
      writeNavigation(key, value);
      return { key, value };
    });
  }, [key]);
  const value = valid(current.value) ? current.value : initial;
  useEffect(() => {
    writeNavigation(key, value);
  }, [key, value]);
  return [value, setValue];
}

/** Vistas existentes que representam expansões como Set guardam somente seus IDs. */
export function useNavigationSet(scope, initialValue) {
  const [ids, setIds] = useNavigationState(scope, () => Array.from(
    typeof initialValue === 'function' ? initialValue() : initialValue
  ));
  const value = useMemo(() => new Set(ids), [ids]);
  const setValue = useCallback(update => setIds(previous => Array.from(
    typeof update === 'function' ? update(new Set(previous)) : update
  )), [setIds]);
  return [value, setValue];
}
