---
title: 'Preferencias de notificaciones'
description: 'Elige qué correos no relacionados con la seguridad quieres recibir.'
locale: es
slug: notification-preferences
section: account
order: 4
---

# Preferencias de notificaciones

Tú eliges qué correos no relacionados con la seguridad te envía RankMeFast. Abre **Ajustes → Notificaciones** (`/settings/notifications`) y activa los interruptores que quieras.

Los interruptores de auditoría, posiciones y reglas de aviso vienen **activados** por defecto; **Novedades del producto** viene **desactivado** y solo se envía cuando lo activas. Un cambio surte efecto de inmediato: el siguiente correo coincidente se omite (o se envía, si activaste un interruptor).

## Qué controla cada interruptor

- **Auditoría completada**: se envía cuando termina una auditoría para uno de tus sitios.
- **Caída de posición**: se envía cuando una palabra clave seguida ha bajado y una segunda comprobación lo confirma.
- **Reglas de aviso**: se envía cuando se activa una de tus propias [reglas de aviso](./alerts.es.md). Este interruptor solo cubre el canal de correo. Los envíos a Slack y webhook siguen funcionando.
- **Facturación**: recibos de pago, avisos de pago fallido y recordatorios de cobro. Desactivarlo silencia todos los correos de facturación; aún puedes ver los recibos y facturas anteriores en **Facturación → Facturas**.
- **Novedades del producto**: mensajes de bienvenida ocasionales, noticias y consejos.

## Caída de posición y reglas de aviso son independientes

El correo de **Caída de posición** viene integrado. RankMeFast lo envía cuando una palabra clave seguida baja y una segunda comprobación confirma la bajada, sin que definas ningún umbral. Las reglas de aviso las creas tú en **Alertas → Reglas** (`/dashboard/alerts?tab=rules`). Eliges el umbral y el destino del aviso, incluidos Slack o un webhook firmado. Ninguna sustituye a la otra. Desactivar **Caída de posición** deja funcionando tus reglas de aviso, y borrar todas las reglas deja activo el correo integrado.

## El Pulso semanal es una activación aparte

El resumen del [Pulso semanal](./weekly-pulse.es.md) no se controla con los interruptores anteriores. Cada compañero lo activa por sitio desde el workspace de AI Visibility del sitio, y permanece desactivado hasta que lo haga.

Si un envío se reintenta, igualmente recibes cada resumen una sola vez. Si tu dirección no puede recibir el correo, los demás compañeros suscritos siguen recibiendo el suyo.

## Los correos de seguridad no se pueden desactivar

Los siguientes correos siempre se envían, independientemente de los interruptores anteriores:

- Enlace para restablecer la contraseña.
- Verificación del correo electrónico.
- Confirmación de cambio de contraseña.

Estos correos protegen tu cuenta. Si recibes uno que no esperabas, revisa tus sesiones activas y restablece tu contraseña desde **Ajustes → Seguridad**.
