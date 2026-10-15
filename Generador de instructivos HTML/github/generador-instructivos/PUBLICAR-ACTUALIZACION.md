# Generador de Instructivos — publicación

Repositorio: lineaitalia/APLICATIVO-DISE-O-DE-CAT-LOGO
Rama: **Instructivo** (no se toca `main` ni su GitHub Pages)
Carpeta: `generador-instructivos/` en la raíz de la rama

- El programa consulta: https://raw.githubusercontent.com/lineaitalia/APLICATIVO-DISE-O-DE-CAT-LOGO/Instructivo/generador-instructivos/version.json
- Descarga para el equipo: https://github.com/lineaitalia/APLICATIVO-DISE-O-DE-CAT-LOGO/raw/Instructivo/generador-instructivos/Instructivo-standalone.html

## Cada actualización
1. Pide el HTML nuevo con un número de versión mayor (ej. 2.0.0 → 2.1.0).
2. En la rama **Instructivo**, entra a `generador-instructivos/` ▸ Add file ▸ Upload files ▸ sube el HTML nuevo (reemplaza al anterior) ▸ Commit.
3. Edita `version.json` (lápiz ✏️):
   - `version`: la nueva → aviso que se puede posponer.
   - `minVersion`: igual a la nueva → bloquea a quien no actualice.
   - `notes`: novedades breves.
4. Los cambios se ven en ~5 minutos (caché de GitHub).

Nunca hagas "Compare & pull request" hacia `main`: mezclaría esta carpeta con el otro programa.
