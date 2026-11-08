document.documentElement.classList.add("js");

const navToggle = document.querySelector("[data-nav-toggle]");
const navigation = document.querySelector("[data-navigation]");

function setNavigation(open) {
  navToggle.setAttribute("aria-expanded", String(open));
  navigation.dataset.open = String(open);
}

if (navToggle && navigation) {
  setNavigation(false);
  navToggle.addEventListener("click", () => {
    setNavigation(navToggle.getAttribute("aria-expanded") !== "true");
  });
  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) setNavigation(false);
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      navToggle.getAttribute("aria-expanded") === "true"
    ) {
      setNavigation(false);
      navToggle.focus();
    }
  });
  window
    .matchMedia("(min-width: 821px)")
    .addEventListener("change", () => setNavigation(false));
}

const copyStatus = document.querySelector("#copy-status");

for (const button of document.querySelectorAll("[data-copy]")) {
  const label = button.querySelector("[data-copy-label]");
  const source = button.closest(".code-card")?.querySelector("code");
  if (!label || !source) continue;
  let reset;
  button.addEventListener("click", async () => {
    clearTimeout(reset);
    try {
      await navigator.clipboard.writeText(source.textContent.trim());
      label.textContent = "Copied";
      if (copyStatus)
        copyStatus.textContent = `${button.dataset.copy} copied to the clipboard.`;
    } catch {
      label.textContent = "Copy";
      if (copyStatus)
        copyStatus.textContent =
          "Copying is unavailable. Select the text and copy it manually.";
    }
    reset = setTimeout(() => {
      label.textContent = "Copy";
    }, 2500);
  });
}
