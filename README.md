# Digicyus AI

Plataforma multiempresa de chatbots inteligentes para WhatsApp (Node.js + Express + MySQL + API de IA).

**Estado:** estructura inicial con conexión a MySQL preparada. Incluye una ruta de prueba de IA (Gemini); aún no hay WhatsApp ni lógica de negocio.

## Rutas

| Ruta | Descripción |
|------|-------------|
| `GET /` | Mensaje de que Digicyus AI está funcionando |
| `GET /app/` | Frontend: página de presentación y demo de chat con la IA |
| `GET /health` | Estado en JSON |
| `GET /health/db` | Comprueba la conexión a MySQL (`200` si funciona, `503` con mensaje genérico si falla) |
| `POST /api/ai/test` | Prueba de IA: recibe `{"message": "..."}` y devuelve `{"reply": "..."}` |
| `GET /webhook` | Reservada para la verificación de WhatsApp Cloud API (responde 501 por ahora) |

## Estructura

```
server.js            Punto de entrada (escucha en process.env.PORT)
public/              Frontend estático (HTML, CSS y JS sin build), servido en /app/
src/app.js           Configuración de Express
src/config/          Variables de entorno
src/routes/          Definición de rutas
src/controllers/     Manejadores de las rutas
src/services/db.js   Conexión a MySQL (usa solo process.env.DB_*)
src/services/gemini.js Cliente de la Interactions API de Gemini (usa GEMINI_API_KEY)
src/services/        Lógica de negocio (IA, WhatsApp...) - futuro
db/schema.sql        Esquema inicial (no se ejecuta automáticamente)
src/models/          Acceso a datos / multiempresa - futuro
src/middlewares/     Middlewares - futuro
src/utils/           Utilidades
```

## Instalación local

Requiere Node.js 18 o superior.

```bash
npm install
cp .env.example .env   # completa los valores
npm start
```

Luego abre http://localhost:3000/ y http://localhost:3000/health.

## Variables de entorno

Ver `.env.example`. Las credenciales **nunca** se suben al repositorio (`.env` está en `.gitignore`).

## Base de datos MySQL

La conexión usa únicamente `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`. GoDaddy las configura automáticamente en la app; en local ponlas en tu `.env`.

1. Aplica `db/schema.sql` manualmente en tu base de datos (phpMyAdmin/Adminer del panel de GoDaddy o `mysql -h HOST -u USER -p DB_NAME < db/schema.sql`). Solo usa `CREATE TABLE IF NOT EXISTS`: no borra ni modifica datos existentes.
2. Prueba la conexión: `GET /health/db` debe responder `{"status":"ok","database":"connected"}`. Si falla, responde `503` sin revelar detalles; el código de error se registra en los logs de la app.

**Multiempresa:** `bots`, `contacts`, `conversations` y `messages` llevan `business_id`, con claves foráneas compuestas `(id, business_id)` para impedir cruzar datos entre negocios. Toda consulta debe filtrar por `business_id`.

## IA con Gemini (prueba)

Usa la **Interactions API** de Gemini (`POST https://generativelanguage.googleapis.com/v1beta/interactions`, clave en el header `x-goog-api-key`). Variables: `GEMINI_API_KEY` (obligatoria, solo en variables de entorno), `GEMINI_MODEL` (opcional, por defecto `gemini-3.8-flash`) y `GEMINI_THINKING_LEVEL` (opcional: `minimal`, `low`, `medium` o `high`, para reducir la latencia). Hay una sola llamada a Google con un límite de 25 s, sin reintentos ni búsqueda de modelos; si el modelo deja de estar disponible, el error de Google queda en los logs y basta con cambiar `GEMINI_MODEL`.

El asistente responde en español como asistente comercial de Digicyus AI y tiene instrucción de no inventar precios, pedidos ni datos del negocio. Esta ruta **no guarda nada en MySQL**.

```bash
curl -X POST https://TU-VISTA-PREVIA/api/ai/test \
  -H "Content-Type: application/json" \
  -d '{"message": "Hola, ¿qué puede hacer Digicyus AI por mi negocio?"}'
```

Respuesta: `{"reply":"..."}`. Errores: `400` (mensaje ausente, no es texto o supera 1000 caracteres), `429` (cuota de la IA), `502` (fallo de Google), `504` (más de 25 s sin respuesta), `503` (clave o modelo no disponibles). Los logs muestran el código HTTP de Gemini y su mensaje (sin la clave). Los mensajes son genéricos; la clave nunca se registra ni se devuelve.

## Frontend

Está en `public/` y Express lo sirve en `/app/`; no requiere build ni dependencias. La demo de chat llama a `POST /api/ai/test` (sin memoria entre mensajes). Como esa ruta consume cuota de Gemini y es pública, tiene un límite global de 20 solicitudes por minuto (configurable con `AI_RATE_LIMIT_PER_MIN`). Antes de publicarla de forma abierta conviene añadir autenticación.

## Pruebas

```bash
npm test
```

Usan Node `node --test` con Gemini simulado (no consumen cuota ni necesitan clave).

## Despliegue en GoDaddy Node.js Hosting

1. Sube el código a GitHub (este repositorio).
2. En GoDaddy, abre tu producto de hosting Node.js y crea/importa la aplicación desde el repositorio.
3. Configura el comando de instalación `npm install`, el de build `npm run build` y el de inicio `npm start` (archivo de entrada: `server.js`).
4. Define las variables de entorno del archivo `.env.example` en el panel de GoDaddy (no hace falta definir `PORT`; la plataforma lo asigna).
5. Inicia/reinicia la aplicación y verifica `https://tu-dominio/health`.

> Los pasos exactos del panel pueden variar; consulta la documentación vigente de GoDaddy.
