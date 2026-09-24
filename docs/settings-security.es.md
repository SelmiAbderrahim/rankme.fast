---
title: 'Seguridad de la cuenta'
description: 'Cambia tu contraseña y gestiona las credenciales de la cuenta.'
locale: es
slug: settings-security
section: account
order: 3
---

# Seguridad de la cuenta

Administra las credenciales que protegen tu cuenta de RankMeFast desde **Ajustes → Seguridad** (URL: `/settings/security`).

## Cambiar la contraseña

1. Inicia sesión y abre **Ajustes → Seguridad**.
2. Introduce tu **contraseña actual**, elige una **nueva contraseña** y confírmala. La nueva contraseña debe tener al menos ocho caracteres y ser distinta de la actual.
3. Pulsa **Actualizar contraseña**.

Guardamos los hashes de contraseña con scrypt, así que nunca vemos tu contraseña en texto plano. Cuando el cambio se realiza correctamente:

- Cerramos **el resto** de sesiones activas de tu cuenta. El dispositivo desde el que hiciste el cambio permanece conectado.
- Enviamos un correo de confirmación a la dirección asociada a tu cuenta. Si no fuiste tú, ese correo es la señal para restablecer la contraseña de inmediato mediante [el flujo de contraseña olvidada](./getting-started.es.md).

Si la contraseña actual es incorrecta, te lo indicamos junto al campo. Nunca revelamos si existe una cuenta para un correo determinado.

## Cambiar tu correo

1. Inicia sesión y abre **Ajustes → Seguridad**.
2. Introduce el **nuevo correo** en la tarjeta *Cambiar correo*. Debe ser distinto del actual.
3. Pulsa **Enviar enlace de verificación**.

Enviamos un enlace de confirmación a la **nueva** dirección. El correo de tu cuenta solo cambia cuando sigues ese enlace:

- Tu **correo actual sigue funcionando** para iniciar sesión hasta que confirmes.
- Si la nueva dirección ya pertenece a otra cuenta, rechazamos el cambio con un mensaje genérico *correo no disponible*, sin revelar a quién pertenece.
- El enlace es de un solo uso y caduca en poco tiempo; solicita otro cambio desde la misma página si eso ocurre.

## ¿Olvidaste la contraseña actual?

Si no recuerdas tu contraseña actual, cierra sesión y usa **¿Olvidaste tu contraseña?** en la pantalla de inicio de sesión. El enlace del correo te llevará a una página donde podrás elegir una nueva sin confirmar la anterior.


## Autenticación de dos factores

Añade un segundo paso al iniciar sesión para que una contraseña robada no baste para acceder a tu cuenta.

### Activar

1. Inicia sesión y abre **Ajustes → Seguridad**.
2. En la tarjeta **Autenticación de dos factores**, introduce tu contraseña actual y pulsa **Activar**.
3. Escanea el código QR con una app como 1Password, Authy o Google Authenticator, o pega el código manual en la app.
4. Copia o descarga los **códigos de respaldo**. Cada uno funciona una sola vez. Son la única forma de volver si pierdes el dispositivo.
5. Introduce el código de seis dígitos que muestra tu app y pulsa **Verificar y activar**.

### Desactivar

Abre la misma tarjeta, pulsa **Desactivar** e introduce tu contraseña actual.

### Cuentas de administrador

Si tu cuenta tiene el rol **Admin**, la autenticación de dos factores es obligatoria. No podrás abrir el panel de administración hasta activarla.

### Dispositivo perdido

Usa un código de respaldo en la pantalla de verificación: hay un enlace **Usar un código de respaldo**. Si te quedas sin códigos, un admin puede restablecer el segundo factor desde el panel.

## Tus derechos sobre los datos

Puedes solicitar una exportación o la eliminación de los datos de tu cuenta. La exportación actual se limita a los conjuntos presentes en el archivo generado y excluye las instantáneas de Páginas y el historial temporal de GSC y del seguimiento de posiciones. La eliminación tiene un alcance mayor: después del periodo de gracia borra los datos guardados de la cuenta aunque no formen parte de la exportación. Puedes cancelar la solicitud durante ese periodo. Consulta [Rendimiento de páginas](./pages-performance.es.md) para conocer la conservación de esos datos.
