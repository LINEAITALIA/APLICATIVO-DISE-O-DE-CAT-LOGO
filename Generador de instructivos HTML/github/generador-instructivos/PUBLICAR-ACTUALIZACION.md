# Generador de Instructivos — publicación

Repositorio: LINEAITALIA/APLICATIVO-DISE-O-DE-CAT-LOGO
Rama: **Instructivo** (no se toca `main` ni su GitHub Pages)
Carpeta: `Generador de instructivos HTML/github/generador-instructivos/`

- El programa consulta: https://raw.githubusercontent.com/LINEAITALIA/APLICATIVO-DISE-O-DE-CAT-LOGO/Instructivo/Generador%20de%20instructivos%20HTML/github/generador-instructivos/version.json
- Descarga para el equipo: https://github.com/LINEAITALIA/APLICATIVO-DISE-O-DE-CAT-LOGO/raw/Instructivo/Generador%20de%20instructivos%20HTML/github/generador-instructivos/Instructivo-standalone.html

## Cada actualización
1. Pide el HTML nuevo con un número de versión mayor (ej. 2.0.0 → 2.1.0).
2. En la rama **Instructivo**, entra a `Generador de instructivos HTML/github/generador-instructivos/` ▸ Add file ▸ Upload files ▸ sube el HTML nuevo (reemplaza al anterior) ▸ Commit.
3. Edita `version.json` (lápiz ✏️):
   - `version`: la nueva → aviso que se puede posponer.
   - `minVersion`: igual a la nueva → bloquea a quien no actualice.
   - `notes`: novedades breves.
4. Los cambios se ven en ~5 minutos (caché de GitHub).

Nunca hagas "Compare & pull request" hacia `main`: mezclaría esta carpeta con el otro programa.
