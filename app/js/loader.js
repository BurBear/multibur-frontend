// Bloquear scroll inmediatamente si el loader existe
if (document.getElementById("loader")) {
  document.body.style.overflow = 'hidden';
}

document.addEventListener("DOMContentLoaded", () => {
  // Ajustar la longitud de la clase .write para las letras SVG
  document.querySelectorAll(".write").forEach(p => {
    const len = Math.ceil(p.getTotalLength());
    p.style.setProperty("--dash", len + 2); 
  });
});

window.addEventListener("load", () => {
  // Ocultar el loader despues de 1.5 segundos
  setTimeout(() => {
    const loader = document.getElementById("loader");
    if (loader) {
      loader.classList.add("hide-loader");
      document.body.style.overflow = ''; // Restaurar scroll
      
      // Opcional: remover el nodo del DOM tras la animación (0.5s definidos en CSS)
      setTimeout(() => {
        loader.remove();
      }, 500);
    }
  }, 1500); 
});
