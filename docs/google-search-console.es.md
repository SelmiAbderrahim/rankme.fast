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

## Cuando Google pide volver a conectar
Si Google invalida el token (por ejemplo, tras cambiar la contraseña de tu cuenta), la tarjeta de Google Search Console de la pestaña **Google** del sitio muestra una alerta roja, **Tu conexión con Google necesita renovarse**, con un botón **Reconectar**. Las tarjetas que leen Search Console o Google Analytics muestran **Search Console no está conectado** o **Google Analytics no está conectado**, con **Conectar Google**. Hasta que vuelvas a conectar, las tres reglas vuelven a "datos insuficientes".

## Elegir la propiedad
La pestaña **Google** del sitio asocia automáticamente tu sitio a una propiedad de Search Console. Si ninguna coincide, o coinciden varias, RankMeFast te pide que elijas una. Una propiedad que pertenece a otro sitio solo se puede vincular tras tu confirmación, porque sus datos de búsqueda aparecerían entonces en este sitio. Google Analytics funciona igual. Si los datos más recientes de Google Analytics son más antiguos de lo esperado, un aviso lo indica y **Actualizar** vuelve a sincronizarlos; RankMeFast también los sincroniza una vez al día.

## Rendimiento en Páginas

La [guía de rendimiento de páginas](./pages-performance.es.md) explica cómo usa la pestaña Páginas las filas guardadas de Search Analytics. La indexabilidad que muestra procede del último rastreo de RankMeFast y no indica si Google ha indexado la URL.

[Volver al índice de la documentación](./index.es.md)
