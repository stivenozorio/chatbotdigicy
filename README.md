# Digicyus AI

Plataforma multiempresa de chatbots inteligentes para WhatsApp (Node.js + Express + MySQL + API de IA).

**Estado:** estructura inicial con conexión a MySQL preparada. Aún no hay IA ni lógica de negocio.

## Rutas

| Ruta | Descripción |
|------|-------------|
| `GET /` | Mensaje de que Digicyus AI está funcionando |
| `GET /health` | Estado en JSON |
| `GET /health/db` | Comprueba la conexión a MySQL (`200` si funciona, `503` con mensaje genérico si falla) |
| `GET /webhook` | Reservada para la verificación de WhatsApp Cloud API (responde 501 por ahora) |

## Estructura

```
server.js            Punto de entrada (escucha en process.env.PORT)
src/app.js           Configuración de Express
src/config/          Variables de entorno
src/routes/          Definición de rutas
src/controllers/     Manejadores de las rutas
src/services/db.js   Conexión a MySQL (usa solo process.env.DB_*)
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

## Despliegue en GoDaddy Node.js Hosting

1. Sube el código a GitHub (este repositorio).
2. En GoDaddy, abre tu producto de hosting Node.js y crea/importa la aplicación desde el repositorio.
3. Configura el comando de instalación `npm install`, el de build `npm run build` y el de inicio `npm start` (archivo de entrada: `server.js`).
4. Define las variables de entorno del archivo `.env.example` en el panel de GoDaddy (no hace falta definir `PORT`; la plataforma lo asigna).
5. Inicia/reinicia la aplicación y verifica `https://tu-dominio/health`.

> Los pasos exactos del panel pueden variar; consulta la documentación vigente de GoDaddy.
