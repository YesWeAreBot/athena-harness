const state = {
  lives: [],
  bodies: [],
  modes: [],
  pipelines: [],
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function refresh() {
  const [lives, bodies, modes, pipelines] = await Promise.all([
    api("/api/lives"),
    api("/api/bodies"),
    api("/api/modes"),
    api("/api/pipelines"),
  ]);
  state.lives = lives;
  state.bodies = bodies;
  state.modes = modes;
  state.pipelines = pipelines;
  render();
}

function render() {
  renderCards("lives", state.lives, (item) => `${item.id} / mode: ${item.activeModeId ?? "-"} / bodies: ${item.bodyIds.join(", ")}`);
  renderCards("bodies", state.bodies, (item) => `${item.id} / ${item.name ?? "-"} / actuators: ${(item.actuators ?? []).join(", ")}`);
  renderCards("modes", state.modes, (item) => item.name);
  renderCards("pipelines", state.pipelines, (item) => `${item.id} / ${item.trigger.join(", ")} / ${item.execution}`);
}

function renderCards(id, items, describe) {
  const root = document.getElementById(id);
  root.replaceChildren();
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "card";
    card.textContent = describe(item);
    root.append(card);
  }
}

document.getElementById("refresh").addEventListener("click", refresh);
document.getElementById("life-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("life-id").value;
  const mode = document.getElementById("life-mode").value;
  const bodies = document.getElementById("life-bodies").value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  await api("/api/lives", {
    method: "POST",
    body: JSON.stringify({ id, mode, bodies }),
  });
  event.target.reset();
  await refresh();
});

refresh().catch((error) => {
  document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="error">${error.message}</p>`);
});
