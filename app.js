// StudyFlow: persistent personal study tracking + Firebase shared rooms.
// Progress is saved on this device using localStorage. Shared rooms use Firebase Realtime Database.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, set, update, onValue, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCkZVPGJoxQfPTSy2muPWpnBJmhHS0qxmw",
  authDomain: "studyos-d68d2.firebaseapp.com",
  databaseURL: "https://studyos-d68d2-default-rtdb.firebaseio.com",
  projectId: "studyos-d68d2",
  storageBucket: "studyos-d68d2.firebasestorage.app",
  messagingSenderId: "50175053645",
  appId: "1:50175053645:web:4747eaaced1b2dca47b104",
  measurementId: "G-CYQ5316NX8"
};

const $ = id => document.getElementById(id);
const STORAGE_KEY = "studyflow-progress-v2";
const NAME_KEY = "studyflow-name";
const SESSION_SECONDS = 25 * 60;
const DAILY_GOAL_MINUTES = 120;

let auth = null, db = null, uid = null, activeRoom = null, roomUnsubscribe = null;
let sharedData = null, personalInterval = null, personalRunning = false;
let personalSeconds = SESSION_SECONDS, personalEndsAt = null;
let progress = loadProgress();
const personalStart = $("personal-start");

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { days: p.days && typeof p.days === "object" ? p.days : {}, timer: p.timer || null };
  } catch { return { days: {}, timer: null }; }
}
function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }
  catch (e) { console.warn("Progress could not be saved", e); }
}
function dayRecord(key = localDateKey()) {
  if (!progress.days[key]) progress.days[key] = { minutes: 0, sessions: 0 };
  return progress.days[key];
}
function toast(message, error = false) {
  const el = $("toast");
  if (!el) { console[error ? "error" : "log"](message); return; }
  el.textContent = message; el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
  setTimeout(() => el.classList.add("hidden"), 3000);
}
function setConnection(online, label) {
  if ($("connection-dot")) $("connection-dot").style.background = online ? "var(--green)" : "#f3b44c";
  if ($("connection-text")) $("connection-text").textContent = label;
}
function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
}
function weekKeys() {
  const now = new Date(), mondayOffset = (now.getDay()+6)%7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate()-mondayOffset);
  return Array.from({length:7}, (_,i) => {
    const d = new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+i);
    return {key:localDateKey(d), date:d};
  });
}
function renderWeeklyChart() {
  const chart = $("today-bar")?.parentElement?.parentElement;
  if (!chart) return;
  const bars = Array.from(chart.children).slice(0,7);
  const days = weekKeys(), labels = ["M","T","W","T","F","S","S"];
  const max = Math.max(60, ...days.map(d => Number(progress.days[d.key]?.minutes || 0)));
  days.forEach((d,i) => {
    const wrap = bars[i]; if (!wrap) return;
    const bar = wrap.querySelector("i"), label = wrap.querySelector("small");
    const mins = Number(progress.days[d.key]?.minutes || 0);
    if (bar) { bar.style.height = `${mins ? Math.max(8, Math.round(mins/max*100)) : 4}%`; bar.title = `${d.key}: ${mins} minutes`; }
    if (label) { label.textContent = labels[i]; label.title = d.key; }
  });
}
function renderProgress() {
  const today = dayRecord(), minutes = Number(today.minutes || 0), sessions = Number(today.sessions || 0);
  const pct = Math.min(100, Math.round(minutes / DAILY_GOAL_MINUTES * 100));
  if ($("today-minutes")) $("today-minutes").textContent = minutes;
  if ($("session-count")) $("session-count").textContent = minutes;
  if ($("goal-percent")) $("goal-percent").textContent = `${pct}%`;
  if ($("goal-bar")) $("goal-bar").style.width = `${pct}%`;
  const ring = document.querySelector(".progress-ring");
  if (ring) {
    ring.style.background = `conic-gradient(var(--cyan, #35c6d5) ${pct*3.6}deg, var(--line, #e7edf3) 0deg)`;
    ring.setAttribute("aria-label", `${pct}% of daily goal completed`);
  }
  const label = $("session-count")?.parentElement?.querySelector("span");
  if (label) label.textContent = `focus minutes · ${sessions} session${sessions===1 ? "" : "s"}`;
  renderWeeklyChart();
}
function saveTimerState() {
  progress.timer = { seconds:personalSeconds, running:personalRunning, endsAt:personalRunning ? personalEndsAt : null };
  saveProgress();
}
function renderPersonal() {
  if ($("personal-time")) $("personal-time").textContent = formatTime(personalSeconds);
  if ($("personal-state")) $("personal-state").textContent = personalRunning ? "Stay in the zone" : (personalSeconds===0 ? "Session complete!" : "Ready when you are");
  if (personalStart) personalStart.textContent = personalRunning ? "Ⅱ Pause focus" : "▶ Start focus";
  renderProgress();
}
function completePersonalSession() {
  personalRunning = false; personalEndsAt = null; personalSeconds = SESSION_SECONDS;
  if (personalInterval) clearInterval(personalInterval);
  personalInterval = null;
  const today = dayRecord();
  today.minutes = Number(today.minutes || 0) + 25;
  today.sessions = Number(today.sessions || 0) + 1;
  saveTimerState(); saveProgress(); renderPersonal();
  toast("Focus session complete — great work!");
}
function tickPersonalTimer() {
  if (!personalRunning || !personalEndsAt) return;
  personalSeconds = Math.max(0, Math.ceil((personalEndsAt-Date.now())/1000));
  if (personalSeconds <= 0) { completePersonalSession(); return; }
  renderPersonal();
}
function togglePersonalTimer() {
  if (personalRunning) {
    personalSeconds = Math.max(0, Math.ceil(((personalEndsAt || Date.now())-Date.now())/1000));
    personalRunning = false; personalEndsAt = null;
    if (personalInterval) clearInterval(personalInterval);
    personalInterval = null; saveTimerState(); renderPersonal(); return;
  }
  if (personalSeconds <= 0) personalSeconds = SESSION_SECONDS;
  personalRunning = true; personalEndsAt = Date.now()+personalSeconds*1000;
  saveTimerState();
  if (personalInterval) clearInterval(personalInterval);
  personalInterval = setInterval(tickPersonalTimer, 250);
  renderPersonal();
}
function restoreTimer() {
  const saved = progress.timer;
  if (!saved) return;
  personalSeconds = Math.max(0, Math.min(SESSION_SECONDS, Number(saved.seconds ?? SESSION_SECONDS)));
  if (saved.running && saved.endsAt) {
    personalRunning = true; personalEndsAt = Number(saved.endsAt);
    personalSeconds = Math.max(0, Math.ceil((personalEndsAt-Date.now())/1000));
    if (personalSeconds <= 0) {
      // Do not count a session as complete after a reload unless the completion handler saved it.
      personalRunning = false; personalEndsAt = null; personalSeconds = SESSION_SECONDS;
      progress.timer = {seconds:SESSION_SECONDS, running:false, endsAt:null}; saveProgress();
    } else personalInterval = setInterval(tickPersonalTimer, 250);
  }
}
personalStart?.addEventListener("click", togglePersonalTimer);
$("personal-reset")?.addEventListener("click", () => {
  personalRunning = false; personalEndsAt = null; personalSeconds = SESSION_SECONDS;
  if (personalInterval) clearInterval(personalInterval);
  personalInterval = null; saveTimerState(); renderPersonal();
});

$("display-name").value = localStorage.getItem(NAME_KEY) || "";
$("display-name").addEventListener("change", () => localStorage.setItem(NAME_KEY, $("display-name").value.trim()));
$("profile-name").textContent = $("display-name").value.trim() || "Student";
$("display-name").addEventListener("input", () => $("profile-name").textContent = $("display-name").value.trim() || "Student");
function displayName() { return $("display-name").value.trim().slice(0,24) || "Student"; }
function randomRoomCode() { return Math.random().toString(36).slice(2,8).toUpperCase().padEnd(6,"0"); }
function showRoom(code) { $("room-panel").classList.remove("hidden"); $("firebase-hint").classList.add("hidden"); $("active-room-code").textContent = code; }
function renderMembers(members = {}) {
  const list = $("members-list"); list.innerHTML = "";
  const entries = Object.entries(members);
  $("member-count").textContent = `${entries.length} member${entries.length===1 ? "" : "s"}`;
  if (!entries.length) { list.innerHTML = '<li class="empty">No members listed yet.</li>'; return; }
  for (const [id, member] of entries) {
    const li = document.createElement("li"), left = document.createElement("span");
    left.className = "member-name";
    const bubble = document.createElement("span"); bubble.className = "member-bubble"; bubble.textContent = (member.name||"S").slice(0,1).toUpperCase();
    const name = document.createElement("span"); name.textContent = member.name || "Student"; left.append(bubble,name);
    const meta = document.createElement("span"); meta.className = "member-meta"; meta.textContent = id===uid ? "YOU · ONLINE" : "● ONLINE";
    li.append(left,meta); list.append(li);
  }
}
function subscribeRoom(code) {
  if (roomUnsubscribe) roomUnsubscribe();
  activeRoom = code; showRoom(code);
  roomUnsubscribe = onValue(ref(db,`rooms/${code}`), snapshot => {
    const data = snapshot.val();
    if (!data) { toast("Room was not found or is not accessible.",true); return; }
    sharedData = data; renderMembers(data.members || {});
    const timer = data.timer || {};
    const remaining = timer.running && timer.endsAt ? Math.max(0,Math.ceil((timer.endsAt-Date.now())/1000)) : (timer.remaining ?? SESSION_SECONDS);
    $("shared-time").textContent = formatTime(remaining);
    $("shared-status").textContent = timer.running ? "Group focus is in progress" : "Waiting to start";
    $("shared-start").textContent = timer.running ? "Ⅱ Pause group focus" : "▶ Start group focus";
    $("firebase-hint").classList.add("hidden");
  }, error => toast(`Room update failed: ${error.message}`,true));
}
async function enterRoom(code, create=false) {
  if (!db || !uid) { toast("Firebase is still connecting. Try again in a moment.",true); return; }
  code = String(code||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
  if (code.length!==6) { toast("Room code must have 6 characters.",true); return; }
  try {
    if (create) {
      await set(ref(db,`rooms/${code}`), {
        createdAt:serverTimestamp(),
        timer:{remaining:SESSION_SECONDS,running:false,endsAt:null,startedBy:null},
        members:{[uid]:{name:displayName(),joinedAt:serverTimestamp(),online:true}}
      });
    } else {
      await set(ref(db,`rooms/${code}/members/${uid}`), {name:displayName(),joinedAt:serverTimestamp(),online:true});
                    }
    await onDisconnect(ref(db,`rooms/${code}/members/${uid}/online`)).set(false);
    subscribeRoom(code); toast(create ? "Room created! Share the code with your friends." : "You joined the room!");
  } catch (e) { toast(`Could not ${create ? "create" : "join"} room: ${e.message}`,true); }
}
$("create-room").addEventListener("click", () => enterRoom(randomRoomCode(),true));
$("join-room").addEventListener("click", () => enterRoom($("room-code").value,false));
$("room-code").addEventListener("keydown", e => { if (e.key==="Enter") enterRoom($("room-code").value,false); });
$("copy-room").addEventListener("click", async () => {
  if (!activeRoom) return;
  try { await navigator.clipboard.writeText(activeRoom); toast("Room code copied!"); }
  catch { toast(`Share this code: ${activeRoom}`); }
});
$("leave-room").addEventListener("click", async () => {
  if (activeRoom && db && uid) {
    try { await set(ref(db,`rooms/${activeRoom}/members/${uid}`),null); } catch (e) { console.warn(e); }
  }
  if (roomUnsubscribe) roomUnsubscribe();
  roomUnsubscribe = null; activeRoom = null; sharedData = null;
  $("room-panel").classList.add("hidden"); $("firebase-hint").classList.remove("hidden"); toast("You left the room.");
});
$("shared-start").addEventListener("click", async () => {
  if (!activeRoom || !db || !uid || !sharedData) return;
  const timer = sharedData.timer || {};
  try {
    if (timer.running) {
      const remaining = Math.max(0,Math.ceil(((timer.endsAt||Date.now())-Date.now())/1000));
      await update(ref(db,`rooms/${activeRoom}/timer`),{running:false,remaining,endsAt:null,updatedAt:serverTimestamp()});
    } else {
      const remaining = timer.remaining ?? SESSION_SECONDS;
      await update(ref(db,`rooms/${activeRoom}/timer`),{running:true,remaining,endsAt:Date.now()+remaining*1000,startedBy:uid,updatedAt:serverTimestamp()});
    }
  } catch (e) { toast(`Could not update shared timer: ${e.message}`,true); }
});
$("shared-reset").addEventListener("click", async () => {
  if (!activeRoom || !db || !uid) return;
  try { await update(ref(db,`rooms/${activeRoom}/timer`),{running:false,remaining:SESSION_SECONDS,endsAt:null,updatedAt:serverTimestamp()}); }
  catch (e) { toast(`Could not reset shared timer: ${e.message}`,true); }
});
setInterval(() => {
  if (!activeRoom || !sharedData?.timer?.running) return;
  const seconds = Math.max(0,Math.ceil(((sharedData.timer.endsAt||Date.now())-Date.now())/1000));
  $("shared-time").textContent = formatTime(seconds);
  if (seconds===0 && db) update(ref(db,`rooms/${activeRoom}/timer`),{running:false,remaining:0,endsAt:null,updatedAt:serverTimestamp()}).catch(console.warn);
},1000);

function validFirebaseConfig() {
  return firebaseConfig.apiKey.startsWith("AIza") && firebaseConfig.projectId && firebaseConfig.databaseURL.startsWith("https://");
}
if (validFirebaseConfig()) {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app); db = getDatabase(app); setConnection(false,"Connecting…");
    signInAnonymously(auth).catch(e => { setConnection(false,"Firebase error"); toast(`Firebase sign-in failed: ${e.message}`,true); });
    onAuthStateChanged(auth,user => {
      if (!user) return;
      uid = user.uid; setConnection(true,"Firebase connected");
      $("firebase-hint").textContent = "Firebase connected. Create a room and share its 6-character code with friends.";
    });
  } catch (e) { setConnection(false,"Firebase setup needed"); toast(`Firebase setup error: ${e.message}`,true); }
} else {
  setConnection(false,"Demo mode");
  $("firebase-hint").textContent = "Realtime rooms need Firebase setup. Personal timer and trackers work on this device.";
}

restoreTimer();
renderPersonal();
