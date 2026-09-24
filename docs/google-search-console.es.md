---
title: 'Conectar Google Search Console'
description: 'Por qué conectar, a qué accedemos, cómo desconectar.'
locale: es
slug: google-search-console
section: research
order: 3
---

# Conectar Google Search Console

Search Console es la herramienta gratuita de Google que muestra cómo ve Google tu sitio. Al conectarla, tres reglas usan la respuesta de Google en lugar de una estimación.

## A qué accedemos
- Solo al alcance **de lectura** `webmasters.readonly`.
- No accedemos a Gmail ni a Drive. Solo guardamos un token de actualización cifrado.

## Cómo conectar
1. Ajustes → Google Search Console.
2. Pulsa **Conectar Google Search Console**.
3. Inicia sesión y concede el permiso.

## Desconectar
Pulsa **Desconectar** y eliminamos el token al momento. También puedes revocar el acceso en https://myaccount.google.com/permissions.

## "Se requiere reconexión"
Si Google invalida el token, aparece un aviso rojo. Hasta que vuelvas a conectar, las tres reglas vuelven a "datos insuficientes".

## Rendimiento en Páginas

La [guía de rendimiento de páginas](./pages-performance.es.md) explica cómo usa la pestaña Páginas las filas guardadas de Search Analytics. La indexabilidad que muestra procede del último rastreo de RankMeFast y no indica si Google ha indexado la URL.

[Volver al índice de la documentación](./index.es.md)
