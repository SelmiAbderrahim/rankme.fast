---
title: "Alojar RankMeFast en tu servidor"
description: "Ejecuta RankMeFast en tu servidor con Docker Compose."
locale: es
slug: self-hosting
section: start
order: 5
---

# Alojar RankMeFast en tu servidor

## Antes de empezar

Instala Docker con Compose y descarga el código del proyecto. Ejecuta los comandos desde el directorio del proyecto. El software es gratuito; tú pagas el servidor y el uso de las API de proveedores. Mantén privado el archivo de entorno.

## Configura la instalación

Copia la plantilla y edita el archivo `.env` de la raíz:

```bash
cp .env.example .env
```

Establece `CLIENT_URL` y `SERVER_URL`. `BETTER_AUTH_SECRET` y `MASTER_ENCRYPTION_KEY` necesitan cada uno su propio valor aleatorio; ejecuta `openssl rand -hex 32` una vez para cada uno. Después configura los proveedores reales, sus credenciales y el transporte de correo según `.env.example`. En tu propia instalación puedes dejar `PAYMENT_PROVIDER=none`.

Para una instalación con un único origen, usa el valor de `CLIENT_URL` también en `APP_URL` y `VITE_SITE_URL`.

No arranques con credenciales de ejemplo. En producción, los proveedores simulados se rechazan por defecto, y las excepciones de demostración no deben activarse en un despliegue público.

## Inicia y comprueba

Cuando todo esté configurado, inicia la plataforma y comprueba que todos los servicios están sanos:

```bash
docker compose up -d --build
docker compose ps
```

Luego abre la dirección de `CLIENT_URL`, crea una cuenta y añade tu primer sitio.

## Mantén la instalación

La seguridad del servidor, HTTPS, las actualizaciones y las copias de seguridad de las bases de datos y del archivo de entorno corren de tu cuenta. Haz una copia antes de cada actualización. Si falla el arranque, revisa los registros de los servicios y no compartas registros que contengan credenciales.
