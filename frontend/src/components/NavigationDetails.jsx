import { useNavigationState } from '../utils/useNavigationState';

/** Mantém o elemento nativo e sua acessibilidade, persistindo apenas a expansão. */
export default function NavigationDetails({ navigationScope, children, ...props }) {
  const [open, setOpen] = useNavigationState(`details:${navigationScope}`, false);
  return <details {...props} open={open} onToggle={event => setOpen(event.currentTarget.open)}>{children}</details>;
}
