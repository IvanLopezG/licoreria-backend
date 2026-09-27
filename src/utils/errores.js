// Errores de la aplicación con su código HTTP. Los servicios y modelos lanzan
// el tipo que corresponde a lo que pasó; el middleware central
// (middlewares/manejoErrores.js) decide la respuesta a partir de él. La
// respuesta siempre es { error: mensaje }: el mensaje es para el usuario (en
// español) y el código interno solo va al log.
//
// Un error que no es ErrorApp (pg, un bug) es una falla inesperada: 500 con
// mensaje genérico, nunca el texto crudo de la excepción.

class ErrorApp extends Error {
  // codigo: identificador interno opcional para el log (p. ej. "RESOLUCION_VENCIDA").
  constructor(mensaje, status = 500, codigo) {
    super(mensaje);
    this.name = this.constructor.name;
    this.status = status;
    if (codigo) this.codigo = codigo;
  }
}

// 400: datos inválidos o una regla de negocio que el usuario puede corregir.
class ErrorValidacion extends ErrorApp {
  constructor(mensaje, codigo) {
    super(mensaje, 400, codigo);
  }
}

// 401: sin credenciales válidas (JWT del panel o token de sesión del catálogo).
class ErrorNoAutenticado extends ErrorApp {
  constructor(mensaje, codigo) {
    super(mensaje, 401, codigo);
  }
}

// 403: autenticado, pero su rol no permite la acción.
class ErrorPermiso extends ErrorApp {
  constructor(mensaje, codigo) {
    super(mensaje, 403, codigo);
  }
}

// 404: el recurso no existe (o no existe para quien pregunta).
class ErrorNoEncontrado extends ErrorApp {
  constructor(mensaje, codigo) {
    super(mensaje, 404, codigo);
  }
}

// 409: choca con el estado actual (duplicado, ya anulada, resolución vencida...).
class ErrorConflicto extends ErrorApp {
  constructor(mensaje, codigo) {
    super(mensaje, 409, codigo);
  }
}

// 410: existió pero ya no está disponible (sesión del catálogo vencida o revocada).
class ErrorNoDisponible extends ErrorApp {
  constructor(mensaje, codigo) {
    super(mensaje, 410, codigo);
  }
}

// 429: demasiados intentos. reintentarEn: segundos para el encabezado Retry-After.
class ErrorDemasiadosIntentos extends ErrorApp {
  constructor(mensaje, reintentarEn, codigo) {
    super(mensaje, 429, codigo);
    if (reintentarEn !== undefined) this.reintentarEn = reintentarEn;
  }
}

// 500 intencional: falta configuración del negocio (emisor, secuencia, clave
// técnica). El mensaje sí le sirve al personal del panel; en el catálogo
// público se reemplaza por uno genérico como cualquier 500.
class ErrorInterno extends ErrorApp {
  constructor(mensaje, codigo) {
    super(mensaje, 500, codigo);
  }
}

// 501: función prevista que aún no está conectada (transmisión a la DIAN).
class ErrorNoImplementado extends ErrorApp {
  constructor(mensaje, codigo) {
    super(mensaje, 501, codigo);
  }
}

module.exports = {
  ErrorApp,
  ErrorValidacion,
  ErrorNoAutenticado,
  ErrorPermiso,
  ErrorNoEncontrado,
  ErrorConflicto,
  ErrorNoDisponible,
  ErrorDemasiadosIntentos,
  ErrorInterno,
  ErrorNoImplementado,
};
