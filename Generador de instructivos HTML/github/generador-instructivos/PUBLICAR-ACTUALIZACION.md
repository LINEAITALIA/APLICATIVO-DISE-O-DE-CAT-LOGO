# Cómo publicar una actualización del Generador de Instructivos

## Una sola vez
1. Crea un repositorio **público** en GitHub (ej. `generador-instructivos`).
2. Sube `Instructivo-standalone.html` y `version.json`.
3. En el repositorio: **Settings ▸ Pages ▸ Branch: main / root ▸ Save**. Quedará en `https://lc-prado.github.io/APLICATIVO-DISE-O-DE-CAT-LOGO/generador-instructivos/`.
4. Pide que pongan en el programa `UPDATE_URL = 'https://lc-prado.github.io/APLICATIVO-DISE-O-DE-CAT-LOGO/generador-instructivos/version.json'`.

## Cada actualización
1. Sube el número `APP_VERSION` en el programa (ej. 2.0.0 → 2.1.0) y regenera el HTML.
2. Reemplaza `Instructivo-standalone.html` en el repositorio.
3. Edita `version.json`:
   - `version`: la versión nueva → quien tenga una anterior verá un aviso (puede posponerlo).
   - `minVersion`: la versión mínima permitida → quien tenga una menor queda **bloqueado** hasta descargarla.
   - `notes`: lista breve de novedades.
4. GitHub Pages tarda de 1 a 10 minutos en publicar.

El programa revisa al abrirse y cada 30 minutos. Sin internet deja trabajar normalmente.
