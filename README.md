# Digicyus AI

Plataforma multiempresa de chatbots inteligentes para WhatsApp (Node.js + Express + MySQL + API de IA).

**Estado:** estructura inicial. Aún no hay MySQL, IA ni lógica multiempresa; solo el servidor base.

## Rutas

| Ruta | Descripción |
|------|-------------|
| `GET /` | Mensaje de que Digicyus AI está funcionando |
| `GET /health` | Estado en JSON |
| `GET /webhook` | Reservada para la verificación de WhatsApp Cloud API (responde 501 por ahora) |

## Estructura

```
server.js            Punto de entrada (escucha en process.env.PORT)
src/app.js           Configuración de Express
src/config/          Variables de entorno
src/routes/          Definición de rutas
src/controllers/     Manejadores de las rutas
src/services/        Lógica de negocio (IA, WhatsApp, MySQL...) - futuro
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

## Despliegue en GoDaddy Node.js Hosting

1. Sube el código a GitHub (este repositorio).
2. En GoDaddy, abre tu producto de hosting Node.js y crea/importa la aplicación desde el repositorio.
3. Configura el comando de instalación `npm install`, el de build `npm run build` y el de inicio `npm start` (archivo de entrada: `server.js`).
4. Define las variables de entorno del archivo `.env.example` en el panel de GoDaddy (no hace falta definir `PORT`; la plataforma lo asigna).
5. Inicia/reinicia la aplicación y verifica `https://tu-dominio/health`.

> Los pasos exactos del panel pueden variar; consulta la documentación vigente de GoDaddy.
