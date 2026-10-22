import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { installInspector } from '../lib/inspection/controller';
export default defineUnlistedScript(() => {
  // Reinjection after extension reload replaces the previous isolated-world controller.
  const scope = globalThis as typeof globalThis & { __vclarityDispose?: () => void };
  scope.__vclarityDispose?.();
  scope.__vclarityDispose = installInspector();
});
