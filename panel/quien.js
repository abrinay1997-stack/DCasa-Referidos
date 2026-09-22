/**
 * Enseña arriba a la derecha quién entró.
 *
 * Va en un archivo y no dentro del HTML porque la política de seguridad de
 * contenido (`worker/http.ts`) no permite scripts en línea, y no los permite
 * porque la zona pública sirve HTML a cualquiera con el enlace del QR.
 */
const donde = document.getElementById('quien');

try {
  const respuesta = await fetch('/panel/api/yo', { headers: { Accept: 'application/json' } });
  if (respuesta.ok) {
    const { correo } = await respuesta.json();
    donde.textContent = correo;
  } else {
    const { mensaje } = await respuesta.json().catch(() => ({ mensaje: '' }));
    donde.textContent = mensaje || 'No se pudo comprobar quién entró.';
  }
} catch {
  donde.textContent = 'Sin conexión con el servidor.';
}
