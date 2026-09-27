// ScanLibre · archivos.js
// Pedir archivos con los <input type="file"> escondidos de index.html.

/** Abre el selector y devuelve los archivos elegidos ([] si se canceló) */
export function elegirArchivos(id) {
  return new Promise(resolver => {
    const entrada = document.getElementById(id);
    entrada.value = '';
    entrada.onchange = () => resolver([...entrada.files]);
    entrada.oncancel = () => resolver([]);
    entrada.click();
  });
}
