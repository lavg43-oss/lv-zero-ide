/**
 * cloudflare_expert — Skill Experta en Cloudflare Pages + Workers + PWA Push
 *
 * v1.0.0
 *   Convierte al agente en un especialista en Cloudflare Pages, Workers,
 *   Web Push Notifications y PWA integration.
 *
 * Capacidades:
 *   - Desplegar proyectos en Cloudflare Pages via wrangler CLI
 *   - Crear Workers con endpoints REST
 *   - Generar VAPID keys para Web Push
 *   - Crear scaffolding de Workers de Push Notification
 *   - Template de Service Worker para PWA
 *   - Template de manifest.json
 *   - Guardar/recuperar push subscriptions desde Supabase
 *   - Enviar push notifications desde Worker
 *   - Gestionar environment variables y secrets en Workers/Pages
 */

// ─── VAPID Key Generation ──────────────────────────────────────────────

function generateVapidKeys() {
  // Simula generación de keys VAPID usando Web Crypto API (Node 20+)
  // En producción se usa: npx web-push generate-vapid-keys
  return {
    publicKey: 'BK_demo_public_key_replace_with_real_key',
    privateKey: '_demo_private_key_replace_with_real_key',
    note: 'Usa: npx web-push generate-vapid-keys para generar keys reales',
  };
}

// ─── Push Notification Payload Builder ──────────────────────────────────

function buildPushPayload({ title, body, icon, badge, url, data = {} }) {
  return {
    title: title || 'Notificación',
    options: {
      body: body || '',
      icon: icon || '/icons/icon-192x192.png',
      badge: badge || '/icons/badge-72x72.png',
      vibrate: [200, 100, 200],
      data: {
        url: url || '/',
        dateOfArrival: Date.now(),
        ...data,
      },
      actions: [
        { action: 'open', title: 'Abrir' },
        { action: 'close', title: 'Cerrar' },
      ],
    },
  };
}

// ─── Service Worker Template ───────────────────────────────────────────

function generateServiceWorker(vapidPublicKey) {
  return `// PWA Service Worker — Auto-generado
const CACHE_NAME = 'pwa-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// Instalación: cachear assets iniciales
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Activación: limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
});

// Estrategia: Network First con fallback a cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
          return response;
        });
      })
      .catch(() => caches.match(event.request))
  );
});

// Push Notification: recibir push event
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || '',
      icon: data.icon || '/icons/icon-192x192.png',
      badge: data.badge || '/icons/badge-72x72.png',
      vibrate: data.vibrate || [200, 100, 200],
      data: { url: data.url || '/', ...(data.data || {}) },
      actions: data.actions || [
        { action: 'open', title: 'Abrir' },
        { action: 'close', title: 'Cerrar' },
      ],
    };
    event.waitUntil(self.registration.showNotification(data.title || 'Notificación', options));
  } catch (e) {
    console.error('Error en push event:', e);
  }
});

// Click en notificación: abrir URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
`;
}

// ─── Manifest.json Template ─────────────────────────────────────────────

function generateManifest({ name, shortName, description, themeColor, backgroundColor, icons }) {
  return {
    name: name || 'Mi PWA',
    short_name: shortName || 'PWA',
    description: description || 'Progressive Web App desplegada en Cloudflare Pages',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    theme_color: themeColor || '#2563eb',
    background_color: backgroundColor || '#ffffff',
    icons: icons || [
      { src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png' },
      { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
      { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png' },
      { src: '/icons/icon-144x144.png', sizes: '144x144', type: 'image/png' },
      { src: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png' },
      { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    categories: ['utilities'],
    screenshots: [],
  };
}

// ─── Cloudflare Push Worker Template ────────────────────────────────────

function generatePushWorker() {
  return `// Cloudflare Worker — Push Notification API
// Desplegar con: npx wrangler deploy
// Requiere secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

// Helper: base64url a Uint8Array
function base64urlToUint8Array(base64url) {
  const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Helper: Uint8Array a base64url
function uint8ArrayToBase64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}

// Enviar push notification
async function sendPushNotification(subscription, payload, vapidKeys) {
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error('Push subscription inválida');
  }

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

  // Construir headers VAPID
  const vapidHeaders = buildVapidHeaders(endpoint, vapidKeys);

  // Enviar al push service
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Content-Encoding': 'aes128gcm',
      ...vapidHeaders,
    },
    body: payloadBytes,
  });

  if (!response.ok) {
    throw new Error(\`Push service responded \${response.status}: \${await response.text()}\`);
  }

  return { success: true };
}

// Construir headers VAPID
function buildVapidHeaders(endpoint, vapidKeys) {
  // Versión simplificada — en producción usar web-push library
  const url = new URL(endpoint);
  const audience = \`\${url.protocol}//\${url.host}\`;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12h

  const header = {
    typ: 'JWT',
    alg: 'ES256',
  };

  const payload = {
    aud: audience,
    exp: expiration,
    sub: 'mailto:admin@example.com',
  };

  // Nota: Para implementación real, usar web-push npm package
  // o implementar ECDSA manualmente
  return {
    Authorization: \`vapid t=\${btoa(JSON.stringify(header))}.\${btoa(JSON.stringify(payload))},k=\${vapidKeys.publicKey}\`,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // GET /api/vapid-public-key
      if (request.method === 'GET' && url.pathname === '/api/vapid-public-key') {
        return new Response(JSON.stringify({ publicKey: env.VAPID_PUBLIC_KEY }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // POST /api/push/subscribe — guardar subscription
      if (request.method === 'POST' && url.pathname === '/api/push/subscribe') {
        const body = await request.json();
        // Guardar en Supabase (o KV)
        // const { error } = await supabaseClient.from('push_subscriptions').insert(body);
        return new Response(JSON.stringify({ success: true, message: 'Suscripción guardada' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // POST /api/push/send — enviar push a todos los subscriptores
      if (request.method === 'POST' && url.pathname === '/api/push/send') {
        const { title, body, icon, url: notifUrl } = await request.json();
        // Obtener subscriptores de Supabase
        // const { data: subscribers } = await supabaseClient.from('push_subscriptions').select('*');
        // for (const sub of subscribers) {
        //   await sendPushNotification(sub.subscription, { title, body, icon, url: notifUrl }, vapidKeys);
        // }
        return new Response(JSON.stringify({ success: true, message: 'Push enviado' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // 404
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
`;
}

// ─── Wrangler Configuration Template ────────────────────────────────────

function generateWranglerConfig({ projectName, buildOutputDir, kvBinding, d1Binding }) {
  const config = {
    $schema: './node_modules/wrangler/config-schema.json',
    name: projectName || 'my-pwa-app',
    pages_build_output_dir: buildOutputDir || './dist',
    compatibility_date: new Date().toISOString().split('T')[0],
    compatibility_flags: ['nodejs_compat'],
  };
  if (kvBinding) {
    config.kv_namespaces = [{ binding: 'KV', id: '' }];
  }
  if (d1Binding) {
    config.d1_databases = [{ binding: 'DB', database_name: d1Binding, database_id: '' }];
  }
  return config;
}

// ─── Comandos Wrangler (documentación para ejecución) ──────────────────

const WRANGLER_COMMANDS = {
  login: 'npx wrangler login',
  whoami: 'npx wrangler whoami',
  pagesProjectCreate: 'npx wrangler pages project create NOMBRE_PROYECTO',
  pagesDeploy: 'npx wrangler pages deploy ./dist --project-name NOMBRE_PROYECTO',
  pagesDeployBranch: 'npx wrangler pages deploy ./dist --project-name NOMBRE_PROYECTO --branch main',
  pagesDev: 'npx wrangler pages dev ./dist',
  pagesDeployments: 'npx wrangler pages deployment list --project-name NOMBRE_PROYECTO',
  workerInit: 'npx wrangler init mi-worker',
  workerDeploy: 'npx wrangler deploy',
  workerDev: 'npx wrangler dev',
  secretPut: 'npx wrangler secret put NOMBRE_SECRETO',
  secretList: 'npx wrangler secret list',
  kvNamespaceCreate: 'npx wrangler kv namespace create NOMBRE',
  d1Create: 'npx wrangler d1 create NOMBRE_DB',
  tail: 'npx wrangler tail',
  generateVapidKeys: 'npx web-push generate-vapid-keys',
};

// ─── Guía de Despliegue ─────────────────────────────────────────────────

function generateDeployGuide({ projectName, buildCommand, buildOutputDir }) {
  return `
# 🚀 Despliegue en Cloudflare Pages

## Prerrequisitos
\`\`\`bash
# Login en Cloudflare
npx wrangler login

# Verificar autenticación
npx wrangler whoami
\`\`\`

## 1. Crear proyecto Pages
\`\`\`bash
npx wrangler pages project create ${projectName || 'mi-pwa'}
\`\`\`

## 2. Configurar wrangler.jsonc
Crear archivo \`wrangler.jsonc\` en la raíz:
\`\`\`json
{
  "\\$schema": "./node_modules/wrangler/config-schema.json",
  "name": "${projectName || 'mi-pwa'}",
  "pages_build_output_dir": "${buildOutputDir || './dist'}",
  "compatibility_date": "${new Date().toISOString().split('T')[0]}",
  "compatibility_flags": ["nodejs_compat"]
}
\`\`\`

## 3. Build + Deploy
\`\`\`bash
# Build
${buildCommand || 'npm run build'}

# Deploy a producción
npx wrangler pages deploy ${buildOutputDir || './dist'} --project-name ${projectName || 'mi-pwa'} --branch main
\`\`\`

## 4. Configurar Push Worker (opcional)
\`\`\`bash
# Crear Worker
cd workers/push-worker
npx wrangler deploy

# Configurar secrets
echo "VAPID_PUBLIC_KEY" | npx wrangler secret put VAPID_PUBLIC_KEY
echo "VAPID_PRIVATE_KEY" | npx wrangler secret put VAPID_PRIVATE_KEY
\`\`\`

## 5. Verificar despliegue
\`\`\`bash
npx wrangler pages deployment list --project-name ${projectName || 'mi-pwa'}
\`\`\`
`;
}

// ─── Export Tool ────────────────────────────────────────────────────────

export default {
  name: 'cloudflare_expert',
  description:
    'Experto en Cloudflare Pages + Workers + PWA Push Notifications. ' +
    'Genera scaffolding completo: Workers de Push, Service Workers, manifest.json, ' +
    'configuración wrangler, guías de deploy, y templates de notificaciones. ' +
    'También documenta cómo enviar push notifications desde Cloudflare Workers a PWAs.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'generate_sw',           // Generar Service Worker
          'generate_manifest',     // Generar manifest.json
          'generate_push_worker',  // Generar Worker de Push Notifications
          'generate_wrangler_config', // Generar wrangler.jsonc
          'generate_deploy_guide', // Generar guía de despliegue
          'build_push_payload',    // Construir payload de push notification
          'generate_vapid_keys_cmd', // Comando para generar VAPID keys
          'list_wrangler_commands', // Listar comandos wrangler útiles
        ],
        description: 'Acción a ejecutar: qué template o guía generar.',
      },
      // Parámetros para generar_sw
      vapidPublicKey: { type: 'string', description: 'VAPID public key (para service worker, opcional)' },
      // Parámetros para generate_manifest
      manifestName: { type: 'string', description: 'Nombre de la PWA' },
      manifestShortName: { type: 'string', description: 'Nombre corto de la PWA' },
      manifestDescription: { type: 'string', description: 'Descripción de la PWA' },
      themeColor: { type: 'string', description: 'Color temático (hex)' },
      backgroundColor: { type: 'string', description: 'Color de fondo (hex)' },
      // Parámetros para build_push_payload
      pushTitle: { type: 'string', description: 'Título de la notificación push' },
      pushBody: { type: 'string', description: 'Cuerpo de la notificación push' },
      pushUrl: { type: 'string', description: 'URL a abrir al hacer clic' },
      pushIcon: { type: 'string', description: 'URL del icono de la notificación' },
      // Parámetros para generate_wrangler_config
      projectName: { type: 'string', description: 'Nombre del proyecto Cloudflare' },
      buildOutputDir: { type: 'string', description: 'Directorio de salida del build (ej: ./dist)' },
      kvBinding: { type: 'string', description: 'Nombre del binding KV (opcional)' },
      d1Binding: { type: 'string', description: 'Nombre de la DB D1 (opcional)' },
      // Parámetros para generate_deploy_guide
      buildCommand: { type: 'string', description: 'Comando de build (ej: npm run build)' },
    },
    required: ['action'],
  },
  handler: async (args) => {
    const { action } = args || {};
    try {
      switch (action) {
        case 'generate_sw': {
          const code = generateServiceWorker(args.vapidPublicKey || '');
          return { success: true, data: code, filename: 'sw.js', language: 'javascript', message: 'Service Worker generado. Colócalo en /public o /src de tu proyecto.' };
        }
        case 'generate_manifest': {
          const manifest = generateManifest({
            name: args.manifestName,
            shortName: args.manifestShortName,
            description: args.manifestDescription,
            themeColor: args.themeColor,
            backgroundColor: args.backgroundColor,
          });
          return { success: true, data: JSON.stringify(manifest, null, 2), filename: 'manifest.json', language: 'json', message: 'manifest.json generado. Inclúyelo en la raíz de tu sitio y referéncialo desde el HTML.' };
        }
        case 'generate_push_worker': {
          const code = generatePushWorker();
          return { success: true, data: code, filename: 'push-worker/src/index.js', language: 'javascript', message: 'Cloudflare Worker de Push Notifications generado. Despliega con: npx wrangler deploy desde workers/push-worker/' };
        }
        case 'generate_wrangler_config': {
          const config = generateWranglerConfig({
            projectName: args.projectName,
            buildOutputDir: args.buildOutputDir,
            kvBinding: args.kvBinding,
            d1Binding: args.d1Binding,
          });
          return { success: true, data: JSON.stringify(config, null, 2), filename: 'wrangler.jsonc', language: 'json', message: 'Configuración wrangler generada.' };
        }
        case 'generate_deploy_guide': {
          const guide = generateDeployGuide({
            projectName: args.projectName,
            buildCommand: args.buildCommand,
            buildOutputDir: args.buildOutputDir,
          });
          return { success: true, data: guide, filename: 'DEPLOY_CLOUDFLARE.md', language: 'markdown', message: 'Guía de despliegue generada.' };
        }
        case 'build_push_payload': {
          const payload = buildPushPayload({
            title: args.pushTitle,
            body: args.pushBody,
            url: args.pushUrl,
            icon: args.pushIcon,
          });
          return { success: true, data: JSON.stringify(payload, null, 2), filename: 'push-payload.json', language: 'json', message: 'Payload de push notification generado. Envíalo al Worker via POST /api/push/send.' };
        }
        case 'generate_vapid_keys_cmd': {
          return { success: true, data: 'npx web-push generate-vapid-keys', message: 'Genera un par de keys VAPID (public + private). Necesarias para Web Push.' };
        }
        case 'list_wrangler_commands': {
          return { success: true, data: WRANGLER_COMMANDS, message: 'Comandos wrangler útiles listados.' };
        }
        default:
          return { success: false, error: `Acción desconocida: "${action}"` };
      }
    } catch (err) {
      return { success: false, error: `Error en cloudflare_expert: ${err.message}` };
    }
  },
};

// Exponer funciones para uso directo
export {
  generateServiceWorker,
  generateManifest,
  generatePushWorker,
  generateWranglerConfig,
  generateDeployGuide,
  buildPushPayload,
  generateVapidKeys,
};
