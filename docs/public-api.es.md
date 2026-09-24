---
title: 'API pública'
description: 'Lee tus sitios, informes, posiciones y palabras clave mediante una API sencilla autenticada con clave. Función Agency.'
locale: es
slug: public-api
section: developers
order: 1
---

# API pública

La API pública ofrece acceso de solo lectura a los datos que RankMeFast ya guarda de tu cuenta: sitios, el último informe de auditoría, el historial de posiciones y las palabras clave seguidas. Es una función **Agency** (consulta [Planes, límites y créditos](./plans-limits-credits.es.md)). Nunca genera trabajo nuevo con proveedores; solo lee lo que tus auditorías y comprobaciones de posición ya han producido.

Content Intelligence no forma parte de `/api/v1`: iniciar un análisis o cambiar una recomendación solo se puede hacer en la aplicación con sesión iniciada. MCP puede leer análisis guardados, pero no puede iniciar uno ni cambiar recomendaciones.

## Autenticación

Crea una clave en **Cuenta → Claves de API** (`/profile?tab=api-keys`). La clave completa se muestra **exactamente una vez**: cópiala de inmediato; después solo será visible su prefijo. Puedes tener hasta diez claves activas y revocar cualquiera en cualquier momento. Una clave revocada deja de funcionar de inmediato.

Envía la clave como token bearer en cada solicitud:

```
Authorization: Bearer rmf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Sustituye `https://your-rankme-host` en los ejemplos por el origen de tu api (el `SERVER_URL` de tu instalación).

## Idioma de respuesta y contrato de datos

Elige el idioma de la respuesta con `x-lang` y, después, con `Accept-Language`; si no, la API usa `en`. Los valores regionales como `fr-CA` se convierten en `fr`. `/api/v1` ignora las cookies del navegador, el idioma de la cuenta y las preferencias del espacio de trabajo. Cada respuesta indica el idioma usado en `Content-Language` y añade `x-lang, Accept-Language` a `Vary`, conservando los valores existentes.

Solo se traducen los textos que redacta RankMeFast (informes, hallazgos, acciones y mensajes de error seguros). No cambian los nombres de propiedades JSON, estados HTTP, códigos de error estables, valores de enumeración y estado, ID, dominios, URL, palabras clave, marcas de tiempo, mediciones, observaciones, cursores ni textos guardados del usuario o proveedor. El idioma nunca altera la ordenación ni el formato de números y fechas.

El CSV es idéntico byte a byte en todos los idiomas: BOM UTF-8, nombres y orden de columnas, orden de filas, escape RFC-4180, valores, finales de línea, nombre de archivo, cabeceras de paginación y comportamiento del cursor. `Content-Language` indica el idioma elegido, pero no traduce ni renombra nada en el CSV.

## Puntos de acceso

### Listar tus sitios

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/sites
```

Devuelve `{ "sites": [{ "id", "domain", "url", "createdAt" }] }`.

### Último informe de auditoría de un sitio

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/sites/<siteId>/report/latest
```

Devuelve la auditoría **completada** más reciente como `{ "runId", "report" }`, con los mismos hallazgos, categorías y textos localizados que muestra el panel. Responde `404` si el sitio aún no tiene una auditoría terminada.

### Historial de posiciones de un sitio

```bash
curl -H "Authorization: Bearer rmf_..." \
  "https://your-rankme-host/api/v1/sites/<siteId>/rank-history?from=2026-06-01&to=2026-07-01"
```

Devuelve `{ "keywords": [{ "id", "phrase", "series": [...] }] }`. Cada punto incluye la posición, la URL que posicionó y las señales de Google AI Overview (`aiOverviewPresent`, `aiCited`, `aiCitedUrl`). `from` y `to` son fechas ISO opcionales.

### Todas las palabras clave seguidas

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/keywords
```

Devuelve cada palabra clave seguida en todos tus sitios con su última posición, delta y los campos de AI Overview.

## Exportaciones CSV y filas almacenadas

Con `PUBLIC_EXPORTS_ENABLED` activo, solicita CSV en cualquier ruta de lista con `?format=csv` o `Accept: text/csv`. Los archivos tienen columnas estables, BOM UTF-8, comillas RFC-4180 y texto protegido frente a fórmulas. El JSON de las cuatro rutas originales no cambia. El historial acepta `engine=google|bing|youtube|amazon`; sin filtro, la columna `engine` incluye todos los motores.

Los CSV del historial y de palabras clave conservan la salida anterior sin paginar salvo que añadas `limit` o un `cursor` opaco. Una página de historial acepta de 1 a 25 grupos de palabras clave (hasta 730 puntos por grupo), mientras que una página de palabras clave acepta de 1 a 1.000 filas. Envía el valor de `X-Next-Cursor` en la siguiente solicitud y detente cuando falte esa cabecera. JSON ignora estos parámetros de paginación CSV y mantiene su contrato original.

Se añaden dos lecturas almacenadas: `GET /api/v1/serp-features?siteId=<siteId>` y `GET /api/v1/backlink-rows?siteId=<siteId>`. Ambas aceptan `limit` de 1 a 1.000 y un `cursor` opaco, devuelven solo filas de la cuenta y llevan `sourceKind=provider_observation` (`source_kind` en CSV). Con la bandera apagada, estas rutas y CSV responden `503`, pero el JSON original sigue activo. Sigue la [guía de Looker Studio](./looker-studio.es.md) para configurar el conector y los campos.

## Límites de uso

Por defecto, cada clave puede hacer **120 solicitudes por minuto**. Por encima de eso la API responde `429` hasta que se reinicia la ventana.

## Errores

Los errores usan la forma `{ "error": { "message": "...", "details": ... } }`. El mensaje legible sigue `x-lang`, después `Accept-Language` y por último `en`; el estado, los campos, los códigos estables y los detalles no cambian con el idioma:

- `401`: la clave falta, está mal formada, revocada o es desconocida.
- `402`: tu plan no incluye la API.
- `404`: el sitio o el informe no existe en tu cuenta.
- `429`: límite de uso superado (cuerpo: `{ "error": "..." }`).

## Compatibilidad

Esta versión expone exactamente seis rutas de solo lectura:

- `GET /api/v1/sites`
- `GET /api/v1/sites/:siteId/report/latest`
- `GET /api/v1/sites/:siteId/rank-history`
- `GET /api/v1/keywords`
- `GET /api/v1/serp-features`
- `GET /api/v1/backlink-rows`

Radar de marca, Inteligencia de reseñas, Inteligencia de enlaces, Información de tráfico y Tendencias de palabras clave no tienen rutas en `/api/v1`. Son funciones del panel que requieren sesión. Los campos existentes mantienen su significado, y los clientes deben ignorar los campos nuevos que no reconozcan.

<!-- public-api-routes: GET /api/v1/sites; GET /api/v1/sites/:siteId/report/latest; GET /api/v1/sites/:siteId/rank-history; GET /api/v1/keywords; GET /api/v1/serp-features; GET /api/v1/backlink-rows -->

[Volver al índice de la documentación](./index.es.md)
