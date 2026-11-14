(() => {
  "use strict";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const audio = document.getElementById("song");
  const noteImage = new Image();
  noteImage.src = "assets/star-of-david-large.png";
  const startScreen = document.getElementById("start-screen");
  const pauseScreen = document.getElementById("pause-screen");
  const resultScreen = document.getElementById("result-screen");
  const startButton = document.getElementById("start-button");
  const pauseButton = document.getElementById("pause-button");
  const resumeButton = document.getElementById("resume-button");
  const replayButton = document.getElementById("replay-button");
  const scoreElement = document.getElementById("score");
  const comboElement = document.getElementById("combo");
  const accuracyElement = document.getElementById("accuracy");
  const progressElement = document.getElementById("progress");
  const feedbackElement = document.getElementById("feedback");
  const loadStatus = document.getElementById("load-status");

  const bpm = 128;
  const beat = 60 / bpm;
  const leadIn = 2.2;
  const hitWindow = 0.22;
  const slideDuration = 0.7;
  const laneColors = ["#ff5a9a", "#54e6f4"];
  const patterns = [
    [0, 2, 4, 6],
    [0, 3, 4, 7],
    [1, 3, 4, 6],
    [0, 2, 5, 7],
    [0, 2, 4, 5, 7],
    [1, 3, 4, 6, 7],
    [0, 3, 5, 7],
    [0, 2, 4, 6, 7]
  ];

  let notes = [];
  let particles = [];
  let stars = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let hitX = 0;
  let lanes = [0, 0];
  let speed = 440;
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let judged = 0;
  let accuracyTotal = 0;
  let active = false;
  let paused = false;
  let finished = false;
  let feedbackTimer = 0;
  let lastFrame = 0;
  let elapsed = 0;
  let audioReady = false;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const formatScore = value => String(value).padStart(6, "0");

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hitX = Math.max(70, Math.min(width * 0.205, 190));
    lanes = [height * 0.39, height * 0.69];
    speed = clamp(width * 0.48, 260, 510);
    stars = Array.from({ length: Math.floor(width * height / 4200) }, (_, index) => ({
      x: (index * 197.3) % width,
      y: (index * 83.7) % height,
      r: (index % 3 + 1) * 0.55,
      phase: index * 1.7
    }));
    draw();
  }

  function buildChart() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 120;
    notes = [];
    let id = 0;
    const barLength = beat * 4;
    for (let bar = 0, start = leadIn; start < duration - 0.2; bar++, start += barLength) {
      const pattern = patterns[bar % patterns.length];
      for (const step of pattern) {
        const time = start + step * beat / 2;
        if (time >= duration - 0.15) continue;
        const lane = (bar + Math.floor(step / 2) + (step % 2)) % 2;
        const isSlide = bar % 4 === 2 && step === 4;
        notes.push({
          id: id++,
          time,
          lane,
          fromLane: isSlide ? 1 - lane : lane,
          type: isSlide ? "slide" : "tap",
          judged: false
        });
        if (bar % 4 === 3 && step === 4) {
          const extraLane = 1 - lane;
          notes.push({ id: id++, time: time + beat / 2, lane: extraLane, fromLane: extraLane, type: "tap", judged: false });
        }
      }
    }
    notes.sort((a, b) => a.time - b.time);
  }

  function updateHud() {
    scoreElement.textContent = formatScore(score);
    comboElement.innerHTML = `${combo}<span>×</span>`;
    const accuracy = judged ? Math.round(accuracyTotal / judged) : 100;
    accuracyElement.innerHTML = `${accuracy}<span>%</span>`;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    progressElement.style.width = `${duration ? clamp(audio.currentTime / duration * 100, 0, 100) : 0}%`;
  }

  function showFeedback(text, color) {
    feedbackElement.textContent = text;
    feedbackElement.style.color = color;
    feedbackElement.classList.add("show");
    window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => feedbackElement.classList.remove("show"), 330);
  }

  function makeParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * 2 * i / count;
      const velocity = 1.3 + Math.random() * 2.8;
      particles.push({
        x, y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: 1,
        color,
        size: 2 + Math.random() * 3
      });
    }
  }

  function hit(lane) {
    if (!active || paused || finished) return;
    const now = audio.currentTime;
    let nearest = null;
    let nearestDelta = Infinity;
    for (const note of notes) {
      if (note.judged || note.lane !== lane) continue;
      const delta = Math.abs(note.time - now);
      if (delta < nearestDelta) {
        nearest = note;
        nearestDelta = delta;
      }
    }
    if (!nearest || nearestDelta > hitWindow) {
      combo = 0;
      showFeedback("MISS", "#ff719e");
      updateHud();
      return;
    }

    nearest.judged = true;
    const grade = nearestDelta <= 0.075 ? "PERFECT" : nearestDelta <= 0.145 ? "GREAT" : "GOOD";
    const points = grade === "PERFECT" ? 1000 : grade === "GREAT" ? 700 : 400;
    const accuracy = grade === "PERFECT" ? 100 : grade === "GREAT" ? 85 : 65;
    score += points + Math.min(combo, 50) * 10 + (nearest.type === "slide" ? 300 : 0);
    combo++;
    maxCombo = Math.max(maxCombo, combo);
    judged++;
    accuracyTotal += accuracy;
    showFeedback(nearest.type === "slide" ? `SLIDE ${grade}` : grade, laneColors[lane]);
    makeParticles(hitX, lanes[lane], laneColors[lane], grade === "PERFECT" ? 12 : 8);
    updateHud();
  }

  function missExpiredNotes() {
    const now = audio.currentTime;
    for (const note of notes) {
      if (!note.judged && now > note.time + hitWindow) {
        note.judged = true;
        judged++;
        combo = 0;
        accuracyTotal += 0;
      }
    }
  }

  function drawBackground(time) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#11102b");
    gradient.addColorStop(0.55, "#17102b");
    gradient.addColorStop(1, "#101426");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(width * 0.73, height * 0.28, 0, width * 0.73, height * 0.28, width * 0.5);
    glow.addColorStop(0, "rgba(110, 44, 131, .2)");
    glow.addColorStop(1, "rgba(110, 44, 131, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    for (const star of stars) {
      const alpha = 0.25 + (Math.sin(time * 1.5 + star.phase) + 1) * 0.2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = star.phase % 2 ? "#f7eaff" : "#75eaf3";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const baseY = height * 0.91;
    const skylineStep = Math.max(25, width / 25);
    for (let x = 0, i = 0; x < width; x += skylineStep, i++) {
      const buildingHeight = 20 + ((i * 43 + 19) % 70);
      ctx.fillStyle = i % 2 ? "rgba(22, 23, 50, .78)" : "rgba(27, 21, 51, .82)";
      ctx.fillRect(x, baseY - buildingHeight, skylineStep - 2, buildingHeight);
      ctx.fillStyle = i % 2 ? "rgba(84, 230, 244, .25)" : "rgba(255, 78, 145, .25)";
      for (let wy = baseY - buildingHeight + 9; wy < baseY - 5; wy += 13) {
        if ((i + Math.round(wy)) % 3 !== 0) ctx.fillRect(x + 5, wy, 2, 3);
      }
    }
    ctx.fillStyle = "rgba(9, 8, 23, .6)";
    ctx.fillRect(0, baseY, width, height - baseY);
  }

  function drawLanes(time) {
    for (let i = 0; i < 2; i++) {
      const y = lanes[i];
      const color = laneColors[i];
      ctx.save();
      ctx.strokeStyle = i ? "rgba(84, 230, 244, .16)" : "rgba(255, 78, 145, .16)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 8]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const pulse = 0.45 + (Math.sin(time * 7 + i) + 1) * 0.15;
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(hitX, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      ctx.strokeStyle = color;
      ctx.globalAlpha = .68;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hitX, y, 19 + (Math.sin(time * 5 + i) + 1) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function drawNote(note, now) {
    const x = hitX + (note.time - now) * speed;
    if (x < -40 || x > width + 40) return;
    const slideStart = note.time - slideDuration;
    const progress = note.type === "slide" ? clamp((now - slideStart) / slideDuration, 0, 1) : 1;
    const y = lanes[note.fromLane] + (lanes[note.lane] - lanes[note.fromLane]) * progress;
    const noteHeight = 38;
    const noteWidth = noteHeight * noteImage.naturalWidth / noteImage.naturalHeight;
    ctx.save();
    if (note.type === "slide" && now >= slideStart) {
      const trailTime = Math.max(slideStart, now - 0.32);
      const trailProgress = clamp((trailTime - slideStart) / slideDuration, 0, 1);
      const trailX = x + (now - trailTime) * speed;
      const trailY = lanes[note.fromLane] + (lanes[note.lane] - lanes[note.fromLane]) * trailProgress;
      const trail = ctx.createLinearGradient(trailX, trailY, x, y);
      trail.addColorStop(0, "rgba(84, 230, 244, .08)");
      trail.addColorStop(1, "rgba(84, 230, 244, .9)");
      ctx.strokeStyle = trail;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.shadowColor = "#54e6f4";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(trailX, trailY);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.shadowColor = "#1712ff";
    ctx.shadowBlur = 14;
    if (noteImage.complete && noteImage.naturalWidth) {
      ctx.drawImage(noteImage, x - noteWidth / 2, y - noteHeight / 2, noteWidth, noteHeight);
    }
    ctx.restore();
  }

  function drawAvatar(time) {
    const x = width * .81;
    const y = height * .54 + Math.sin(time * 4) * 5;
    const scale = clamp(height / 460, .75, 1.15);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.shadowColor = "rgba(255, 78, 145, .35)";
    ctx.shadowBlur = 34;
    ctx.fillStyle = "rgba(255, 78, 145, .08)";
    ctx.beginPath();
    ctx.ellipse(0, 43, 73, 92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#342045";
    ctx.beginPath();
    ctx.ellipse(0, 48, 34, 42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4c2b9";
    ctx.beginPath();
    ctx.ellipse(0, -4, 27, 31, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2b193a";
    ctx.beginPath();
    ctx.arc(0, -13, 28, Math.PI, Math.PI * 2);
    ctx.lineTo(27, 0);
    ctx.quadraticCurveTo(13, -7, 0, -3);
    ctx.quadraticCurveTo(-15, -13, -27, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#29183a";
    ctx.fillRect(-17, -3, 12, 3);
    ctx.fillRect(5, -3, 12, 3);
    ctx.fillStyle = "#ff719e";
    ctx.fillRect(-12, 8, 4, 2);
    ctx.fillRect(8, 8, 4, 2);
    ctx.strokeStyle = "#ef9d91";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 11, 6, .2, Math.PI - .2);
    ctx.stroke();
    ctx.strokeStyle = "#54e6f4";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-25, 30);
    ctx.lineTo(-42, 55 + Math.sin(time * 5) * 8);
    ctx.moveTo(25, 31);
    ctx.lineTo(42, 16 - Math.sin(time * 5) * 8);
    ctx.stroke();
    ctx.strokeStyle = "#f4c2b9";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-8, 81);
    ctx.lineTo(-21, 106 + Math.sin(time * 5) * 5);
    ctx.moveTo(10, 81);
    ctx.lineTo(25, 104 - Math.sin(time * 5) * 5);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles(delta) {
    particles = particles.filter(particle => particle.life > 0);
    for (const particle of particles) {
      particle.life -= delta * 1.8;
      if (particle.life <= 0) continue;
      particle.x += particle.vx * delta * 60;
      particle.y += particle.vy * delta * 60;
      ctx.globalAlpha = particle.life;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw(time = 0, delta = 0) {
    if (!ctx || !width || !height) return;
    drawBackground(time);
    drawLanes(time);
    const now = active || paused || finished ? audio.currentTime : 0;
    if (notes.length) {
      for (const note of notes) {
        if (!note.judged && note.time > now - hitWindow) drawNote(note, now);
      }
    }
    drawAvatar(time);
    drawParticles(delta);
  }

  function finishGame() {
    if (finished) return;
    finished = true;
    active = false;
    pauseButton.disabled = true;
    const accuracy = judged ? Math.round(accuracyTotal / judged) : 0;
    document.getElementById("final-score").textContent = formatScore(score);
    document.getElementById("result-title").innerHTML = accuracy >= 80 ? "You crushed it<span>!</span>" : "Nice moves<span>!</span>";
    document.getElementById("result-kicker").textContent = accuracy >= 80 ? "DANCE FLOOR LEGEND" : "KEEP THE GROOVE GOING";
    document.getElementById("result-summary").textContent = `${accuracy}% accuracy · ${maxCombo} best combo`;
    resultScreen.hidden = false;
    updateHud();
  }

  function frame(timestamp) {
    const delta = Math.min((timestamp - (lastFrame || timestamp)) / 1000, .05);
    lastFrame = timestamp;
    if (active && !paused) {
      elapsed = audio.currentTime;
      missExpiredNotes();
      updateHud();
      if (audio.ended || (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration)) finishGame();
    }
    draw(timestamp / 1000, delta);
    window.requestAnimationFrame(frame);
  }

  async function beginGame() {
    if (!audioReady) return;
    score = 0;
    combo = 0;
    maxCombo = 0;
    judged = 0;
    accuracyTotal = 0;
    particles = [];
    finished = false;
    paused = false;
    elapsed = 0;
    buildChart();
    updateHud();
    audio.currentTime = 0;
    try {
      await audio.play();
    } catch (error) {
      loadStatus.textContent = "Could not play the song. Check that the audio file is available.";
      console.error("Audio playback failed:", error);
      return;
    }
    startScreen.hidden = true;
    resultScreen.hidden = true;
    pauseScreen.hidden = true;
    active = true;
    pauseButton.disabled = false;
    pauseButton.setAttribute("aria-label", "Pause game");
    canvas.focus({ preventScroll: true });
  }

  function togglePause(forcePause) {
    if (!active || finished) return;
    const shouldPause = typeof forcePause === "boolean" ? forcePause : !paused;
    paused = shouldPause;
    if (paused) {
      audio.pause();
      pauseScreen.hidden = false;
      pauseButton.setAttribute("aria-label", "Resume game");
    } else {
      audio.play().catch(error => {
        console.error("Audio resume failed:", error);
        togglePause(true);
      });
      pauseScreen.hidden = true;
      pauseButton.setAttribute("aria-label", "Pause game");
    }
  }

  startButton.addEventListener("click", beginGame);
  replayButton.addEventListener("click", beginGame);
  resumeButton.addEventListener("click", () => togglePause(false));
  pauseButton.addEventListener("click", () => togglePause());

  window.addEventListener("keydown", event => {
    if (event.code === "Space") event.preventDefault();
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (["f", "s", "d"].includes(key)) hit(0);
    if (["j", "k", "l"].includes(key)) hit(1);
    if (key === "p") togglePause();
    if (event.key === "Escape" && active) {
      audio.pause();
      active = false;
      paused = false;
      finished = false;
      audio.currentTime = 0;
      startScreen.hidden = false;
      pauseScreen.hidden = true;
      resultScreen.hidden = true;
      pauseButton.disabled = true;
    }
  });

  canvas.addEventListener("pointerdown", event => {
    const rect = canvas.getBoundingClientRect();
    const lane = event.clientY - rect.top < lanes[1] - lanes[0] / 2 ? 0 : 1;
    hit(lane);
  });

  audio.addEventListener("loadedmetadata", () => {
    audioReady = true;
    buildChart();
    loadStatus.textContent = `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, "0")} track loaded · BPM ${bpm}`;
    startButton.disabled = false;
  });
  audio.addEventListener("error", () => {
    loadStatus.textContent = "Track could not be loaded. Make sure the assets folder is present.";
    startButton.disabled = true;
  });

  startButton.disabled = true;
  if (audio.readyState >= 1) {
    audioReady = true;
    buildChart();
    loadStatus.textContent = `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, "0")} track loaded · BPM ${bpm}`;
    startButton.disabled = false;
  }
  window.addEventListener("resize", resize);
  resize();
  window.requestAnimationFrame(frame);
})();
