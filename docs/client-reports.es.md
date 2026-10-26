---
title: 'Informes de cliente y portal'
description: 'Cómo se componen los informes PDF de marca blanca a partir de instantáneas guardadas, cómo entregan las programaciones y qué es —y qué no— un enlace de portal revocable.'
locale: es
slug: client-reports
section: product
order: 11
---

# Informes de cliente y portal

Los informes de cliente convierten instantáneas guardadas de auditoría, posiciones y Search Console en un PDF con tu marca. Puedes enviarlo por correo de forma programada o compartirlo con un enlace de solo lectura.

<!-- docs-truth: metric=none; unit=none-composed-from-stored-snapshots; cache-hits=not-applicable; refund=not-applicable; cadence=weekly-or-monthly; estimates=first-party-snapshots -->

## Qué contiene un informe

Cada informe reúne los últimos hallazgos de auditoría con secciones de posiciones y de Search Console, bajo el nombre de empresa, el color de acento y el logotipo de tu cuenta.

El nombre de la empresa, el color de acento y el logotipo se definen en la página **Espacio de trabajo** de los ajustes (`/settings/workspace`), y solo el propietario del espacio puede cambiarlos. Sube el logotipo como PNG, JPEG o SVG de hasta 256 KB. Se guarda como PNG, y se rechaza un SVG que contenga scripts o enlaces a otros archivos.

Al enviar un informe no se descarga nada; se compone con instantáneas guardadas. Por eso cada cifra aparece junto a la fecha en que se observó.

Una sección sin instantánea guardada se marca como aún no observada. Nunca se rellena con una estimación.

## Programaciones

Los informes se envían por correo, cada semana o cada mes. El registro de entregas tiene una entrada por destinatario: pendiente, enviada, fallida o suprimida. Eliges la zona horaria y la hora en esa zona, y la programación mantiene esa hora local cuando cambia el horario de verano.

Componer y enviar un informe no llama a ningún proveedor ni consume unidades medidas. El coste es de nuestra propia infraestructura, así que lo acotan límites estructurales.

## Enlaces del portal

Un enlace de portal es una URL de solo lectura que caduca y se puede revocar.

No hay inicio de sesión, ni comentarios, ni asientos de cliente. Quien tenga el enlace ve el informe tal como se publicó.

La revocación surte efecto en la siguiente petición, así que quien no haya cargado ya la página se queda fuera al instante.

## Límites

Los briefs de contenido no se incluyen en los informes v1. Un informe solo contiene lo que ya se recopiló: una sección aparece cuando existen las instantáneas en las que se basa.

[Volver al índice de documentación](./index.es.md)
