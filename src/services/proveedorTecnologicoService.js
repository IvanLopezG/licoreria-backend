// Punto de conexión con el proveedor tecnológico de factura electrónica.
//
// La transmisión a la DIAN (validación previa) NO se hace desde esta app: lo
// normal es enviarla por la API de un proveedor tecnológico ya habilitado
// (Factus, Siigo, Alegra...), que firma el XML con el certificado, lo envía a
// la DIAN y devuelve el CUFE, el XML firmado y el estado de validación. Esa
// respuesta es la que vale legalmente; el CUFE/XML generados en local son la
// base para "software propio" y una previsualización.
//
// TODO (cuando el dueño elija proveedor): implementar transmitir() con la API
// de ese proveedor. Credenciales en .env (p. ej. PROVEEDOR_FE_URL,
// PROVEEDOR_FE_TOKEN), nunca en la base de datos. Al recibir respuesta:
// - validada: UPDATE facturas_electronicas SET estado_transmision = 'validada',
//   cufe = <CUFE del proveedor>, xml_ubl = <XML firmado>, fecha_transmision = ahora.
// - rechazada: estado_transmision = 'rechazada', mensaje_transmision = <errores>.

async function transmitir(/* factura, documentoElectronico, emisor */) {
  const err = new Error(
    "La transmisión a la DIAN aún no está conectada: falta configurar la API del proveedor tecnológico " +
      "(ver src/services/proveedorTecnologicoService.js)."
  );
  err.status = 501;
  throw err;
}

module.exports = { transmitir };
