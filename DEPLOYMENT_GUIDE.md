# DEPLOYMENT_GUIDE

## Abrir localmente

Desde la raiz de `Multiservicios_backend_verificado`:

```powershell
python .\server.py
```

Abrir:

```text
http://127.0.0.1:8090/
```

## Despliegue recomendado

1. Subir el proyecto a un VPS, hosting Python o contenedor.
2. Ejecutar `server.py` detras de Nginx, Caddy o Apache reverse proxy.
3. Activar HTTPS obligatorio.
4. Definir `MS_ADMIN_PASSWORD`, `MS_SECRET_KEY`, `MS_ADMIN_EMAIL`, `MS_HOST` y `MS_PORT`.
5. Mantener `storage/` fuera de cualquier carpeta publica.
6. Programar backups de `storage/db/multiservicios.sqlite3` y `storage/pdfs/`.
7. Crear una politica de retencion de datos y revision de solicitudes.
8. Agregar monitoreo, rate limit y logs del proxy cuando haya trafico publico.

## Pasarela de pago

El modo actual es manual y operativo desde `/admin/gestion.html`.

Para Wompi, Mercado Pago u otro proveedor:

1. Crear cuenta del proveedor.
2. Guardar llaves en variables de entorno, nunca en `public/js`.
3. Crear endpoint webhook seguro en el backend.
4. Mapear eventos aprobados/rechazados a `payments.estado`.
5. Registrar referencia, monto, moneda y comprobante.
6. Probar en sandbox antes de produccion.

## Pruebas finales

- Home, menu responsive y logo real.
- Registro de cliente y solicitud empresarial.
- Catalogo de servicios/precios.
- Boton flotante de WhatsApp.
- App de modulos y examen con videos integrados.
- Resultados guardados en SQLite.
- Login admin protegido por cookie `HttpOnly`.
- Gestion operativa en `/admin/gestion.html`.
- Generador conectado a `/api/admin/certificados`.
- PDF guardado en `storage/pdfs/`.
- Validacion publica por `/api/certificados/validar`.
- Certificado anulado aparece como anulado.
