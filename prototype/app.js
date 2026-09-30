"use strict";

// 原型规则独立于 DOM 与计时器，便于单步检查；后续 Qt 核心另行实现。
const SnakeRules = (() => {
  const size = 20;
  const vectors = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
  };
  const opposite = { up: "down", down: "up", left: "right", right: "left" };
  const sameCell = (a, b) => a.x === b.x && a.y === b.y;

  function placeFood(snake, random = Math.random) {
    const occupied = new Set(snake.map((cell) => cell.y * size + cell.x));
    const free = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!occupied.has(y * size + x)) free.push({ x, y });
      }
    }
    if (!free.length) return null;
    const index = Math.min(free.length - 1, Math.max(0, Math.floor(random() * free.length)));
    return free[index];
  }

  function create(random = Math.random) {
    const snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    return { snake, direction: "right", pendingDirection: null, food: placeFood(snake, random), score: 0 };
  }

  function requestDirection(core, direction) {
    if (!vectors[direction] || core.pendingDirection ||
        direction === core.direction || direction === opposite[core.direction]) return false;
    core.pendingDirection = direction;
    return true;
  }

  function step(core, random = Math.random) {
    if (!core.food) return { type: "won", reason: "你填满了整个棋盘！" };
    const direction = core.pendingDirection || core.direction;
    const vector = vectors[direction];
    const head = { x: core.snake[0].x + vector.x, y: core.snake[0].y + vector.y };
    core.pendingDirection = null;
    core.direction = direction;
    if (head.x < 0 || head.x >= size || head.y < 0 || head.y >= size) {
      return { type: "lost", reason: "撞到了边界，下次给自己留一点转弯空间。" };
    }
    const growing = sameCell(head, core.food);
    const body = growing ? core.snake : core.snake.slice(0, -1);
    if (body.some((cell) => sameCell(cell, head))) {
      return { type: "lost", reason: "撞到了自己，下次试着绕一个更大的弯。" };
    }
    core.snake.unshift(head);
    if (!growing) core.snake.pop();
    else {
      core.score += 10;
      core.food = placeFood(core.snake, random);
      if (!core.food) return { type: "won", reason: "你填满了整个棋盘！" };
    }
    return { type: growing ? "ate" : "moved" };
  }

  function example(won) {
    const core = create(() => 0.6);
    if (won) {
      core.snake = [];
      for (let y = 0; y < size; y += 1) {
        for (let offset = 0; offset < size; offset += 1) {
          core.snake.push({ x: y % 2 ? size - 1 - offset : offset, y });
        }
      }
      core.direction = "left";
      core.food = null;
      core.score = 3970;
    } else {
      core.snake = [
        { x: 10, y: 9 }, { x: 11, y: 9 }, { x: 12, y: 9 }, { x: 12, y: 10 },
        { x: 12, y: 11 }, { x: 11, y: 11 }, { x: 10, y: 11 }, { x: 9, y: 11 },
        { x: 8, y: 11 }, { x: 8, y: 10 }, { x: 8, y: 9 }, { x: 8, y: 8 },
        { x: 9, y: 8 }, { x: 10, y: 8 }, { x: 11, y: 8 }, { x: 12, y: 8 },
        { x: 13, y: 8 }
      ];
      core.direction = "up";
      core.score = 140;
      core.food = { x: 15, y: 5 };
    }
    return core;
  }

  return { size, create, requestDirection, step, placeFood, example };
})();

function bootPrototype() {
  const $ = (id) => document.getElementById(id);
  const difficulty = {
    easy: { label: "简单", interval: 240 },
    normal: { label: "普通", interval: 160 },
    hard: { label: "困难", interval: 100 }
  };
  const storageKey = "qt-snake-lab.prototype.v1";
  const settings = { selected: "normal", best: { easy: 0, normal: 0, hard: 0 } };
  const game = {
    page: "home", status: "Ready", core: SnakeRules.create(),
    difficulty: "normal", timer: null, reason: "", sample: false,
    pauseReason: "", pendingAction: null
  };
  const canvas = $("board");
  const context = canvas.getContext("2d");
  let storageNotice = "";
  let forceSaveFailure = false;

  function loadSettings() {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      let invalid = !saved || typeof saved !== "object" || Array.isArray(saved);
      if (!invalid) {
        if (Object.hasOwn(difficulty, saved.selected)) settings.selected = saved.selected;
        else invalid = true;
        for (const level of Object.keys(settings.best)) {
          const value = saved.best && saved.best[level];
          if (Number.isInteger(value) && value >= 0 && value <= 3970 && value % 10 === 0) {
            settings.best[level] = value;
          } else invalid = true;
        }
      }
      if (invalid) storageNotice = "部分本地记录无效，已使用默认值。下次保存将更新原型记录。";
    } catch {
      storageNotice = "无法读取本地记录。本次仍可试玩，难度和最高分暂存于当前页面。";
    }
  }

  function saveSettings() {
    try {
      if (forceSaveFailure) {
        forceSaveFailure = false;
        throw new Error("原型评审：模拟保存失败");
      }
      window.localStorage.setItem(storageKey, JSON.stringify(settings));
      storageNotice = "";
      return true;
    } catch {
      storageNotice = "保存未成功：难度和最高分暂存于当前页面，关闭后可能丢失。游戏仍可继续。";
      return false;
    }
  }

  function announce(message) { $("live-status").textContent = message; }
  function focusBoard() { canvas.focus({ preventScroll: true }); }
  function stopClock() {
    if (game.timer !== null) window.clearTimeout(game.timer);
    game.timer = null;
  }
  function scheduleStep() {
    stopClock();
    if (game.status !== "Running") return;
    game.timer = window.setTimeout(tick, difficulty[game.difficulty].interval);
  }
  function tick() {
    game.timer = null;
    if (game.status !== "Running") return;
    const result = SnakeRules.step(game.core);
    if (result.type === "lost" || result.type === "won") {
      finish(result.type === "won" ? "Won" : "GameOver", result.reason);
      return;
    }
    render();
    if (result.type === "ate") announce("吃到食物，当前 " + game.core.score + " 分。");
    scheduleStep();
  }
  function begin() {
    stopClock();
    game.page = "game";
    game.difficulty = settings.selected;
    game.core = SnakeRules.create();
    game.status = "Running";
    game.sample = false;
    game.reason = "";
    game.pauseReason = "";
    render();
    focusBoard();
    announce("游戏开始，" + difficulty[game.difficulty].label + "难度。");
    scheduleStep();
  }
  function pause(reason = "棋盘已停住，准备好时再继续。", moveFocus = true) {
    if (game.status !== "Running") return;
    stopClock();
    game.status = "Paused";
    game.pauseReason = reason;
    render();
    announce(reason);
    if (moveFocus) $("overlay-primary").focus({ preventScroll: true });
  }
  function resume() {
    if (game.status !== "Paused" || game.pendingAction) return;
    game.status = "Running";
    game.pauseReason = "";
    render();
    focusBoard();
    announce("游戏继续。");
    scheduleStep();
  }
  function finish(status, reason) {
    stopClock();
    game.status = status;
    game.reason = reason;
    if (!game.sample && game.core.score > settings.best[game.difficulty]) {
      settings.best[game.difficulty] = game.core.score;
      saveSettings();
    }
    render();
    announce((status === "Won" ? "胜利！" : "本局结束。") + " 本局 " + game.core.score + " 分。");
    $("overlay-primary").focus({ preventScroll: true });
  }
  function goHome() {
    stopClock();
    game.page = "home";
    game.status = "Ready";
    game.core = SnakeRules.create();
    game.sample = false;
    game.reason = "";
    render();
    $("start-game").focus({ preventScroll: true });
  }
  function requestAction(action) {
    if (game.pendingAction) return;
    if (game.status === "Running" || game.status === "Paused") {
      pause();
      game.pendingAction = action;
      $("confirm-title").textContent = action === "restart" ? "重新开始？" : "返回首页？";
      $("confirm-description").textContent = action === "restart"
        ? "当前进度不会保留，新一局将从 0 分开始。" : "当前进度不会保留，本局将结束。";
      $("accept-confirm").textContent = action === "restart" ? "确认重开" : "确认返回";
      $("confirm-dialog").showModal();
      $("cancel-confirm").focus();
    } else if (action === "restart") begin();
    else goHome();
  }
  function closeConfirmation(accepted) {
    const action = game.pendingAction;
    if (!action) return;
    game.pendingAction = null;
    $("confirm-dialog").close();
    if (accepted) {
      if (action === "restart") begin();
      else goHome();
    } else {
      render();
      $("overlay-primary").focus({ preventScroll: true });
      announce("已取消，游戏保持暂停。");
    }
  }
  function showExample(won) {
    stopClock();
    game.page = "game";
    game.difficulty = settings.selected;
    game.core = SnakeRules.example(won);
    game.sample = true;
    finish(won ? "Won" : "GameOver", won ? "你填满了整个棋盘！" : "撞到了自己，下次试着绕一个更大的弯。");
  }

  function drawBoard() {
    const scale = canvas.width / SnakeRules.size;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#101819";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#213029";
    context.lineWidth = 1;
    context.beginPath();
    for (let i = 0; i <= SnakeRules.size; i += 1) {
      context.moveTo(i * scale, 0);
      context.lineTo(i * scale, canvas.height);
      context.moveTo(0, i * scale);
      context.lineTo(canvas.width, i * scale);
    }
    context.stroke();
    const block = (cell, color, gap, radius) => {
      context.fillStyle = color;
      context.beginPath();
      context.roundRect(cell.x * scale + gap, cell.y * scale + gap, scale - gap * 2, scale - gap * 2, radius);
      context.fill();
    };
    if (game.core.food) {
      context.shadowColor = "#ff987e66";
      context.shadowBlur = 15;
      block(game.core.food, "#ff987e", 7, 5);
      context.shadowBlur = 0;
    }
    game.core.snake.forEach((cell, index) => block(cell, index ? "#76aa56" : "#b4f476", 2, 5));
    const head = game.core.snake[0];
    const centerX = (head.x + .5) * scale;
    const centerY = (head.y + .5) * scale;
    const eyes = {
      right: [[6, -6], [6, 6]], left: [[-6, -6], [-6, 6]],
      up: [[-6, -6], [6, -6]], down: [[-6, 6], [6, 6]]
    };
    context.fillStyle = "#263620";
    for (const [x, y] of eyes[game.core.direction]) {
      context.beginPath();
      context.arc(centerX + x, centerY + y, 2.2, 0, Math.PI * 2);
      context.fill();
    }
    const foodLabel = game.core.food
      ? "食物第 " + (game.core.food.y + 1) + " 行第 " + (game.core.food.x + 1) + " 列。"
      : "棋盘已满。";
    canvas.setAttribute("aria-label", "贪吃蛇棋盘，当前 " + game.core.score + " 分，长度 " + game.core.snake.length +
      "。蛇头第 " + (head.y + 1) + " 行第 " + (head.x + 1) + " 列；" + foodLabel + "方向键或 WASD 转向。");
  }

  function render() {
    $("home-page").hidden = game.page !== "home";
    $("game-page").hidden = game.page !== "game";
    for (const input of document.querySelectorAll('input[name="difficulty"]')) {
      input.checked = input.value === settings.selected;
    }
    $("home-best").replaceChildren(document.createTextNode(settings.best[settings.selected] + " "));
    const unit = document.createElement("small");
    unit.textContent = "分";
    $("home-best").append(unit);
    $("current-score").textContent = game.core.score;
    $("game-best").textContent = settings.best[game.difficulty];
    $("game-difficulty").textContent = difficulty[game.difficulty].label;
    $("game-speed").textContent = difficulty[game.difficulty].interval + " ms";
    $("snake-length").textContent = game.core.snake.length;
    const labels = { Ready: "准备就绪", Running: "游戏进行中", Paused: "已暂停", GameOver: "本局结束", Won: "胜利" };
    $("game-status").textContent = labels[game.status] + (game.sample ? " · 评审示例" : "");
    const terminal = game.status === "GameOver" || game.status === "Won";
    const paused = game.status === "Paused";
    $("pause-game").disabled = terminal;
    $("pause-game").textContent = paused ? "继续游戏" : "暂停游戏";
    $("game-overlay").hidden = !paused && !terminal;
    $("overlay-symbol").textContent = paused ? "Ⅱ" : game.status === "Won" ? "★" : "↗";
    $("overlay-kicker").textContent = paused ? "休息一下" : game.status === "Won" ? "每一格都属于你" : "每一局都是新的练习";
    $("overlay-title").textContent = paused ? "游戏已暂停" : game.status === "Won" ? "漂亮，胜利了！" : "本局结束";
    $("overlay-description").textContent = paused ? game.pauseReason : game.reason;
    $("result-stats").hidden = !terminal;
    $("result-score").textContent = game.core.score;
    $("result-best").textContent = settings.best[game.difficulty];
    $("sample-label").hidden = !game.sample;
    $("overlay-primary").textContent = paused ? "继续游戏" : "再玩一次";
    $("overlay-restart").hidden = terminal;
    $("storage-message").hidden = !storageNotice;
    $("storage-message").textContent = storageNotice;
    if (game.page === "game") drawBoard();
  }

  $("start-game").addEventListener("click", begin);
  $("pause-game").addEventListener("click", () => game.status === "Paused" ? resume() : pause());
  $("overlay-primary").addEventListener("click", () => game.status === "Paused" ? resume() : begin());
  for (const id of ["restart-game", "overlay-restart"]) {
    $(id).addEventListener("click", () => requestAction("restart"));
  }
  for (const id of ["return-home", "overlay-home"]) {
    $(id).addEventListener("click", () => requestAction("home"));
  }
  $("brand-home").addEventListener("click", (event) => {
    event.preventDefault();
    if (game.page === "game") requestAction("home");
  });
  $("cancel-confirm").addEventListener("click", () => closeConfirmation(false));
  $("accept-confirm").addEventListener("click", () => closeConfirmation(true));
  $("confirm-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeConfirmation(false);
  });
  $("confirm-dialog").addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const first = $("cancel-confirm");
    const last = $("accept-confirm");
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  for (const input of document.querySelectorAll('input[name="difficulty"]')) {
    input.addEventListener("change", () => {
      if (game.page !== "home" || !Object.hasOwn(difficulty, input.value)) return;
      settings.selected = input.value;
      saveSettings();
      render();
    });
  }
  $("sample-failure").addEventListener("click", () => showExample(false));
  $("sample-victory").addEventListener("click", () => showExample(true));
  $("storage-failure").addEventListener("click", () => {
    pause("评审保存失败提示，游戏已暂停。", false);
    forceSaveFailure = true;
    saveSettings();
    render();
    announce("已模拟一次保存失败，记录暂存在当前页面。");
  });
  canvas.addEventListener("pointerdown", focusBoard);
  document.addEventListener("keydown", (event) => {
    if (game.page !== "game" || game.pendingAction) return;
    const interactive = event.target instanceof Element && event.target.closest("button, input, summary, a, dialog");
    const keys = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };
    const direction = keys[event.key] || keys[event.key.toLowerCase()];
    if (event.repeat) {
      if (!interactive && (direction || event.code === "Space" || event.key === "Escape")) event.preventDefault();
      return;
    }
    if (event.key === "Escape" && game.status === "Running") {
      event.preventDefault();
      pause();
      return;
    }
    if (interactive) return;
    if (direction && game.status === "Running") {
      event.preventDefault();
      SnakeRules.requestDirection(game.core, direction);
    } else if (event.code === "Space" && (game.status === "Running" || game.status === "Paused")) {
      event.preventDefault();
      game.status === "Running" ? pause() : resume();
    }
  });
  window.addEventListener("blur", () => pause("窗口已失去焦点，游戏自动暂停。回来后请主动继续。", false));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause("页面已切换到后台，游戏自动暂停。回来后请主动继续。", false);
  });
  window.addEventListener("pagehide", stopClock);

  loadSettings();
  render();
}

if (typeof document !== "undefined") bootPrototype();
