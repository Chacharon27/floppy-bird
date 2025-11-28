// Full-featured Flappy clone: sprite image, music loop, volume, difficulties, local leaderboard, mobile UI
(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width = 480;
  const H = canvas.height = 700;

  // UI Elements
  const difficultySel = document.getElementById("difficulty");
  const volumeSlider = document.getElementById("volume");
  const muteBtn = document.getElementById("muteBtn");
  const bestSpan = document.getElementById("best");
  const flapBtn = document.getElementById("flapBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const boardList = document.getElementById("boardList");
  const saveScoreBox = document.getElementById("saveScore");
  const playerNameInput = document.getElementById("playerName");
  const saveBtn = document.getElementById("saveBtn");

  // Audio / music
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new (AudioCtx)();
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = Number(volumeSlider.value || 0.28);
  masterGain.connect(audioCtx.destination);
  let musicInterval = null;
  let musicPlaying = false;
  let muted = false;

  function setVolume(v) {
    masterGain.gain.value = v;
    volumeSlider.value = String(v);
  }
  volumeSlider.addEventListener("input", e => {
    setVolume(Number(e.target.value));
    muted = Number(e.target.value) === 0;
    muteBtn.textContent = muted ? "Unmute" : "Mute";
  });
  muteBtn.onclick = () => {
    muted = !muted;
    if (muted) { masterGain.gain.value = 0; muteBtn.textContent = "Unmute"; }
    else { masterGain.gain.value = Number(volumeSlider.value); muteBtn.textContent = "Mute"; }
  };

  // Sound effects (simple beeps)
  function beep(freq=440, dur=0.08, type='sine', gain=0.14) {
    if (muted) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g); g.connect(masterGain);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur + 0.02);
  }
  function playFlap() { beep(520,0.06,'sawtooth',0.15); }
  function playScore() { beep(880,0.09,'triangle',0.14); }
  function playHit() { beep(140,0.4,'sine',0.22); }

  // Music loop: simple arpeggio pattern using oscillator notes
  const musicNotes = [440, 550, 660, 880, 660, 550]; // loop
  function startMusic() {
    if (musicPlaying || muted) return;
    musicPlaying = true;
    let idx = 0;
    musicInterval = setInterval(() => {
      const n = musicNotes[idx % musicNotes.length];
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = n;
      g.gain.value = 0.05;
      o.connect(g); g.connect(masterGain);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.28);
      o.stop(audioCtx.currentTime + 0.30);
      idx++;
    }, 320);
  }
  function stopMusic() {
    musicPlaying = false;
    if (musicInterval) clearInterval(musicInterval);
    musicInterval = null;
  }

  // Unlock audio on first user input (autoplay policies)
  function unlockAudio() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    startMusic();
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  }
  window.addEventListener('click', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  // Game state & parameters
  let state = "menu"; // menu, playing, crashed, paused
  let frame = 0;
  let pipes = [];
  let score = 0;
  let best = parseInt(localStorage.getItem("flappy_best") || "0", 10);
  bestSpan.textContent = `Best: ${best}`;
  let spawnInterval = 110;
  let pipeSpeed = 2.2;
  let gap = 160;

  // Difficulty mapping
  const difficulties = {
    easy:   { gap: 190, speed: 1.8, spawn: 125 },
    normal: { gap: 160, speed: 2.2, spawn: 110 },
    hard:   { gap: 140, speed: 2.8, spawn: 95 }
  };

  difficultySel.addEventListener("change", () => {
    const d = difficultySel.value;
    gap = difficulties[d].gap;
    pipeSpeed = difficulties[d].speed;
    spawnInterval = difficulties[d].spawn;
  });
  // initialize difficulty
  difficultySel.dispatchEvent(new Event('change'));

  // Bird image sprite (inline SVG)
  const birdSvg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='68' height='48' viewBox='0 0 68 48'>
      <defs><style>.b{fill:#ffd34d}.w{fill:#ff9f1c}.e{fill:#080808}</style></defs>
      <rect width='68' height='48' rx='10' fill='transparent'/>
      <g transform='translate(0,6)'>
        <rect class='b' x='6' y='6' width='44' height='28' rx='6'/>
        <ellipse class='w' cx='16' cy='20' rx='12' ry='6' transform='rotate(-30 16 20)'/>
        <circle class='e' cx='44' cy='14' r='3.5'/>
      </g>
    </svg>`;
  const birdImg = new Image();
  birdImg.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(birdSvg);

  // Bird object
  const bird = {
    x: Math.round(W * 0.25),
    y: Math.round(H * 0.4),
    w: 34,
    h: 24,
    vy: 0,
    gravity: 0.55,
    flapPower: -9.5,
    rotation: 0
  };

  // Ground
  const ground = { y: H - 120, speed: 2, offset: 0 };

  // Controls
  function flap() {
    if (state === "menu") startGame();
    if (state === "playing") {
      bird.vy = bird.flapPower;
      playFlap();
    } else if (state === "crashed") {
      restartToMenu();
    } else if (state === "paused") {
      // resume
      state = "playing";
      startMusic();
    }
  }
  window.addEventListener("keydown", e => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      flap();
    } else if (e.code === "KeyP") {
      togglePause();
    }
  });
  canvas.addEventListener("click", flap);
  flapBtn.addEventListener("click", flap);
  pauseBtn.addEventListener("click", togglePause);

  // Touch support - large on-screen button handles it
  window.addEventListener('touchstart', e => {
    // avoid double handling when flapBtn is pressed; keep passive false elsewhere
    // We let the canvas/click/flapBtn handle the flap.
  }, {passive:true});

  function togglePause() {
    if (state === "playing") { state = "paused"; stopMusic(); }
    else if (state === "paused") { state = "playing"; startMusic(); }
  }

  // Game functions
  function startGame() {
    state = "playing";
    frame = 0;
    pipes = [];
    score = 0;
    bird.y = Math.round(H * 0.4);
    bird.vy = 0;
    bird.rotation = 0;
    startMusic();
    saveScoreBox.classList.add('hidden');
  }

  function restartToMenu() {
    // update best
    if (score > best) {
      best = score;
      localStorage.setItem("flappy_best", String(best));
      bestSpan.textContent = `Best: ${best}`;
    }
    state = "menu";
    stopMusic();
    // prompt to save if high enough
    const leaderboard = loadLeaderboard();
    const lowestTop = leaderboard.length < 5 ? 0 : leaderboard[leaderboard.length-1].score;
    if (score > lowestTop || leaderboard.length < 5) {
      saveScoreBox.classList.remove('hidden');
      playerNameInput.value = '';
      playerNameInput.focus();
    } else {
      saveScoreBox.classList.add('hidden');
    }
    refreshLeaderboardUI();
  }

  // Pipes
  const pipeW = 78;
  function spawnPipe() {
    const topH = Math.round(Math.random() * (H - gap - 200) + 60);
    pipes.push({ x: W + 40, top: topH, bottom: H - topH - gap, passed: false });
  }

  // Collision
  function rectsOverlap(a,b) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  }

  // Draw background & scenery
  function drawBackground() {
    // hills
    ctx.save();
    ctx.fillStyle = "#a3e07a";
    ctx.beginPath();
    ctx.ellipse(W*0.15, H*0.85, 380, 140, 0, 0, Math.PI*2);
    ctx.ellipse(W*0.7, H*0.86, 420, 130, 0, 0, Math.PI*2);
    ctx.fill();
    // clouds
    for (let i=0;i<4;i++){
      const cx = (frame*0.3 + i*220) % (W+200) - 100 - i*60;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(cx, 90 + (i%2)*18, 46, 22, 0, 0, Math.PI*2);
      ctx.ellipse(cx+30, 84 + (i%2)*16, 36, 18, 0, 0, Math.PI*2);
      ctx.ellipse(cx-30, 84 + (i%2)*20, 36, 18, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // Draw pipes
  function drawPipes() {
    ctx.fillStyle = "#3ba44a";
    pipes.forEach(p => {
      ctx.fillRect(p.x, 0, pipeW, p.top);
      ctx.fillRect(p.x, H - p.bottom, pipeW, p.bottom);
      ctx.fillStyle = "#2a8f3b";
      ctx.fillRect(p.x, p.top - 18, pipeW, 16);
      ctx.fillRect(p.x, H - p.bottom - 2, pipeW, 16);
      ctx.fillStyle = "#3ba44a";
    });
  }

  // Draw bird - using birdImg when ready
  function drawBirdSprite() {
    ctx.save();
    const cx = bird.x + bird.w/2;
    const cy = bird.y + bird.h/2;
    ctx.translate(cx, cy);
    ctx.rotate(bird.rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
    if (birdImg.complete) {
      ctx.drawImage(birdImg, bird.x - 4, bird.y - 4, bird.w + 8, bird.h + 8);
    } else {
      // fallback rectangle
      ctx.fillStyle = "#ffd34d";
      ctx.fillRect(bird.x, bird.y, bird.w, bird.h);
    }
    ctx.restore();
  }

  // Draw ground
  function drawGround() {
    const gH = 120;
    ground.offset = (ground.offset - ground.speed) % 60;
    ctx.save();
    ctx.translate(Math.floor(ground.offset), 0);
    ctx.fillStyle = "#d79b5c";
    ctx.fillRect(0, H - gH, W + 100, gH);
    for (let x = -120; x < W + 120; x += 60) {
      ctx.fillStyle = "#b87f4e";
      roundRect(ctx, x, H - gH + 8, 48, gH - 16, 6, true);
      ctx.fillStyle = "#d79b5c";
    }
    ctx.restore();
  }

  // HUD
  function drawHUD() {
    ctx.fillStyle = "#083344";
    ctx.font = "bold 36px Arial";
    ctx.textAlign = "left";
    ctx.fillText(score, 22, 60);
  }

  // Menu & crashed overlays
  function drawMenu() {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "bold 44px Arial";
    ctx.fillText("Pispis nga gago", W/2, H/2 - 80);
    ctx.font = "18px Arial";
    ctx.fillText("Click / Tap / Space to flap", W/2, H/2 - 40);
    ctx.fillText("Choose difficulty, save highscores", W/2, H/2 - 16);
    ctx.restore();
  }
  function drawCrashed() {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ff6b6b";
    ctx.textAlign = "center";
    ctx.font = "bold 44px Arial";
    ctx.fillText("Game Over", W/2, H/2 - 40);
    ctx.fillStyle = "#fff";
    ctx.font = "20px Arial";
    ctx.fillText("Score: " + score + "   Best: " + best, W/2, H/2);
    ctx.fillText("Click / press any key to return", W/2, H/2 + 40);
    ctx.restore();
  }

  // Utilities
  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) ctx.fill();
  }

  // Update loop
  function update() {
    frame++;
    if (state === "playing") {
      bird.vy += bird.gravity;
      bird.vy = Math.min(bird.vy, 12);
      bird.y += bird.vy;
      bird.rotation = Math.max(-30, Math.min(90, bird.vy * 3 + 5));

      if (frame % spawnInterval === 0) spawnPipe();

      for (let i = pipes.length - 1; i >= 0; i--) {
        const p = pipes[i];
        p.x -= pipeSpeed;
        if (!p.passed && p.x + pipeW < bird.x) {
          p.passed = true;
          score++;
          playScore();
        }
        if (p.x + pipeW < -40) pipes.splice(i, 1);
      }

      const birdBox = { x: bird.x, y: bird.y, w: bird.w, h: bird.h };
      for (const p of pipes) {
        const topBox = { x: p.x, y: 0, w: pipeW, h: p.top };
        const bottomBox = { x: p.x, y: H - p.bottom, w: pipeW, h: p.bottom };
        if (rectsOverlap(birdBox, topBox) || rectsOverlap(birdBox, bottomBox)) {
          state = "crashed";
          playHit();
          stopMusic();
        }
      }

      if (bird.y + bird.h >= H - 120) {
        bird.y = H - 120 - bird.h;
        state = "crashed";
        playHit();
        stopMusic();
      }
      if (bird.y < -20) { bird.y = -20; bird.vy = 0; }
    } else if (state === "menu") {
      bird.y = Math.round(H * 0.4 + Math.sin(frame * 0.08) * 10);
      bird.rotation = Math.sin(frame * 0.08) * 6;
    } else if (state === "crashed") {
      if (bird.y + bird.h < H - 120) {
        bird.vy += bird.gravity;
        bird.y += bird.vy;
        bird.rotation = Math.min(90, bird.rotation + 6);
      } else {
        // landed; best handled on restartToMenu
      }
    }
  }

  // Draw loop
  function draw() {
    ctx.clearRect(0,0,W,H);
    drawBackground();
    drawPipes();
    drawBirdSprite();
    drawGround();
    drawHUD();
    if (state === "menu") drawMenu();
    if (state === "crashed") drawCrashed();
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }
  loop();

  // Music control tied to state
  function startMusicIfAllowed() {
    if (!muted) startMusic();
  }

  // Leaderboard (client-side)
  function loadLeaderboard() {
    try {
      return JSON.parse(localStorage.getItem('flappy_leaderboard') || '[]');
    } catch(e) { return []; }
  }
  function saveLeaderboard(list) {
    localStorage.setItem('flappy_leaderboard', JSON.stringify(list));
  }
  function addToLeaderboard(name, scoreVal) {
    if (!name) name = 'Anon';
    const list = loadLeaderboard();
    list.push({ name: name.slice(0,12), score: scoreVal, date: new Date().toISOString() });
    // sort desc
    list.sort((a,b) => b.score - a.score || new Date(b.date) - new Date(a.date));
    // keep top 20
    const top = list.slice(0,20);
    saveLeaderboard(top);
    refreshLeaderboardUI();
  }
  function refreshLeaderboardUI() {
    const list = loadLeaderboard();
    boardList.innerHTML = '';
    (list.slice(0,5)).forEach((item, i) => {
      const li = document.createElement('li');
      li.textContent = `${item.name} — ${item.score}`;
      boardList.appendChild(li);
    });
  }
  refreshLeaderboardUI();

  // Save button action (when player finishes a run)
  saveBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim() || 'Anon';
    addToLeaderboard(name, score);
    saveScoreBox.classList.add('hidden');
    // Optional: send to server
    // fetch('https://your-server.example.com/submit-score', {
    //   method: 'POST',
    //   headers: {'Content-Type':'application/json'},
    //   body: JSON.stringify({name, score})
    // }).then(...).catch(...);
  });

  // Save best on unload
  window.addEventListener('beforeunload', () => {
    if (score > best) localStorage.setItem("flappy_best", String(score));
  });

  // Start/stop music when visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopMusic(); else if (state === 'playing') startMusic();
  });

  // Expose debug functions on window
  window._flappy = {
    startGame: () => startGame(),
    restartToMenu: () => restartToMenu(),
    addToLeaderboard: (n, s) => addToLeaderboard(n, s)
  };

  // small helper to ensure audio plays properly on first user gesture
  function unlock() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('click', unlock);
  }
  window.addEventListener('keydown', unlock);
  window.addEventListener('click', unlock);
})();
