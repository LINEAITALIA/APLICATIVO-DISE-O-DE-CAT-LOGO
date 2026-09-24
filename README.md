# Ingeniería de producto

Aplicativo interno de Línea Italia para dar seguimiento a los entregables de ingeniería de cada SKU del catálogo. Los entregables son:

- Diseño
- Especificación
- Especificación de empaque
- Lista de materiales ERP
- Archivo DXF
- Archivo IGS
- Instructivo
- Ficha técnica

Qué ofrece:

- **Matriz de avance:** una matriz de SKU contra entregable, con el porcentaje de avance de cada SKU.
- **Tablero:** el porcentaje global de SKUs completos, más el avance por entregable y por familia.
- **Historial:** registra quién marcó o desmarcó cada entregable y cuándo; al desmarcar, la causa es obligatoria.
- **Roles:** ingeniero, jefe de ingeniería y consulta, cada uno con su propio usuario y contraseña.

## Tecnología

- **Página:** un solo archivo `index.html`, publicado en GitHub Pages.
- **Datos, usuarios e imágenes:** [Supabase](https://supabase.com), con reglas de seguridad por rol aplicadas en la base de datos (Row Level Security).

Este repositorio no contiene datos ni contraseñas. La llave que aparece en `index.html` es la llave pública de Supabase, que está hecha para usarse en el navegador. Quién puede ver y modificar la información lo deciden las reglas de la base de datos.

## Acceso

Pide la dirección del aplicativo al jefe de ingeniería. Crea tu cuenta con **Crear cuenta** y espera a que él la apruebe.
