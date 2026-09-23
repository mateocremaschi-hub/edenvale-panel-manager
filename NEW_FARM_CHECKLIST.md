# Dar de alta una farm nueva — checklist

## 1. Supabase (5 minutos, no necesita ningún archivo)
1. supabase.com/dashboard → **New project** → nombre de la farm → región **más cercana a Australia** → tamaño de cómputo **Nano** (el más barato).
2. Una vez creado: SQL Editor → pegar y correr `supabase/new-farm-bootstrap.sql` completo.
3. Authentication → Users → **Add user** → tu email → tildar "Auto confirm user".
4. SQL Editor de nuevo:
   ```sql
   update public.profiles set role = 'admin' where email = 'tu@email.com';
   ```
5. Settings del proyecto → API → copiar **Project URL** y **anon/public key**.

## 2. App (con las credenciales del paso 5)
6. Pedile a Claude que agregue esas credenciales a la farm correspondiente en `lib/projects.ts`.
7. Subir el cambio (GitHub Desktop → commit → push), esperar el deploy.
8. Entrar a la app → elegir esa farm → login con el usuario del paso 3.

## 3. Datos (necesita los archivos reales)
9. Excel maestro de paneles → Settings → Import Excel (el importador normal, no el histórico).
10. PDFs de interconexión de bloques (los planos CAD) → pedirle a Claude que arme la geometría, igual que se hizo con Edenvale.
11. **Verificar en campo**, con un tracker real, la dirección de conteo de los strings (la regla del "piercing connector" de Edenvale es un punto de partida, no algo garantizado en otra farm — puede variar).

## 4. Opcional, cuando haga falta
- Excel de coordenadas de picas (para el localizador de drones) → tabla `tracker_picas` ya existe, lista para recibirlo.
- Watts nominales → Settings → "Load panel Watts from master Excel", si el Excel maestro trae esa columna.

---
Los pasos 1-8 se pueden hacer HOY, sin ningún archivo de la farm. Los pasos 9 en adelante esperan a que lleguen el Excel y los planos.
