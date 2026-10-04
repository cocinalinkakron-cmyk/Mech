# 🔧 Mech — seguimiento de reparaciones

Web app para talleres mecánicos: el taller actualiza el estado del carro y **el cliente lo ve en vivo** desde su celular, sin tener que llamar.

- **Sin dependencias**: solo Node.js (18 o más reciente). No hay `npm install`.
- **Se ejecuta en tu computadora**: los datos se guardan en `data/db.json`.
- Estilo minimalista, modo claro/oscuro automático y animaciones.

## Cómo usarla

```bash
npm start          # o: node server.js
```

| Página | URL |
| --- | --- |
| Inicio (el cliente escribe su código) | http://localhost:3000 |
| Panel del taller | http://localhost:3000/taller (PIN `1234`) |
| Seguimiento del cliente | http://localhost:3000/t/CODIGO |

Opciones: `PORT=8080 ADMIN_PIN=4321 node server.js`

### Para que el cliente lo abra en su celular
El celular y la computadora tienen que estar en la **misma red Wi-Fi**. Al arrancar, la consola muestra la dirección de tu red (por ejemplo `http://192.168.1.20:3000`). El panel la usa sola en los enlaces que compartes; también puedes cambiarla en **Ajustes**.

## Funciones

**Taller**
- Crear órdenes (cliente, WhatsApp, vehículo, placa, falla, fecha de entrega, presupuesto).
- 8 etapas: Recibido → Diagnóstico → Presupuesto → Repuestos → En reparación → Control de calidad → Listo → Entregado.
- Notas para el cliente, con frases rápidas.
- Botón **Avisar por WhatsApp** con un mensaje ya escrito y el enlace de seguimiento.
- Panel en vivo: ves al momento cuando el cliente aprueba o rechaza un presupuesto.
- Búsqueda, filtros y resumen (en taller, trabajando, por aprobar, listos).

**Cliente**
- Estado actual, barra de progreso con un carrito animado, línea de etapas e historial.
- Se actualiza solo (Server-Sent Events). Cuando cambia algo suena un aviso, el celular vibra y aparece una notificación del navegador.
- Aprueba o rechaza el presupuesto desde el enlace.
- Confeti 🎉 cuando el carro está listo.

## Estructura
```
server.js          API, archivos estáticos y eventos en vivo
public/
  index.html       inicio / buscar código
  track.*          vista del cliente
  admin.*          panel del taller
  common.js        utilidades e iconos
  styles.css       estilos base
data/db.json       base de datos (se crea sola, con 2 órdenes de ejemplo)
```
