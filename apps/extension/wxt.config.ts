import { defineConfig } from 'wxt';
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Vclarity — Interface Inspector',
    description: 'Inspect the interface. Understand the experience. Exact DOM specs, local palettes, and evidence-aware Vision analysis.',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'scripting', 'sidePanel', 'storage', 'clipboardWrite'],
    host_permissions: ['http://127.0.0.1/*'],
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    action: { default_title: 'Open Vclarity · grant access to this tab', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
    commands: {
      'live-inspect': { suggested_key: { default: 'Alt+I' }, description: 'Vclarity: Live Inspect' },
      'ghost-inspect': { suggested_key: { default: 'Alt+S' }, description: 'Vclarity: Ghost Inspect' },
    },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:4317; style-src 'self' 'unsafe-inline'; worker-src 'self'" },
  },
});
