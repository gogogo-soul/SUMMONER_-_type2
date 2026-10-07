let summonerInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  summonerInstallPrompt = event;
  const btn = document.getElementById("installBtn");
  if (btn) btn.classList.add("available");
});

window.addEventListener("appinstalled", () => {
  summonerInstallPrompt = null;
  const btn = document.getElementById("installBtn");
  if (btn) btn.classList.remove("available");
});

async function installSummoner() {
  if (!summonerInstallPrompt) return;
  summonerInstallPrompt.prompt();
  try {
    await summonerInstallPrompt.userChoice;
  } finally {
    summonerInstallPrompt = null;
    const btn = document.getElementById("installBtn");
    if (btn) btn.classList.remove("available");
  }
}
window.installSummoner = installSummoner;

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("SUMMONER Service Worker registration failed:", err);
    });
  });
}
