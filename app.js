// StudyFlow starter: personal timer works immediately. Shared rooms require Firebase setup.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, set, update, onValue, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "PASTE_YOUR_FIREBASE_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://PASTE_YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "PASTE_YOUR_PROJECT",
  appId: "PASTE_YOUR_APP_ID"
};

const $ = (id) => document.getElementById(id);
let auth = null, db = null, uid = null, activeRoom = null, roomUnsubscribe = null;
let personalSeconds = 25 * 60, personalRunning = false, personalInterval = null;
let sharedInterval = null, sharedData = null, todayMinutes = 0;
const personalStart = $("personal-start");

function toast(message, error = false) {
  const el = $("toast"); el.textContent = message; el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
  setTimeout(() => el.classList.add("hidden"), 3000);
}
function validFirebaseConfig() {
  return firebaseConfig.apiKey.startsWith("AIza") &&
    !firebaseConfig.projectId.startsWith("PASTE_") &&
    !firebaseConfig.databaseURL.includes("PASTE_YOUR");
}
function setConnection(online, label) {
  $("connection-dot").style.background = online ? "var(--green)" : "#f3b44c";
  $("connection-text").textContent = label;
}
function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function renderPersonal() {
  $("personal-time").textContent = formatTime(personalSeconds);
  $("personal-state").textContent = personalRunning ? "Stay in the zone" : (personalSeconds === 0 ? "Session complete!" : "Ready when you are");
  personalStart.textContent = personalRunning ? "Ⅱ Pause focus" : "▶ Start focus";
  const elapsed = Math.max(0, 25 * 60 - personalSeconds);
  const mins = Math.floor(elapsed / 60);
  $("today-minutes").textContent = todayMinutes + mins;
  $("session-count").textContent = todayMinutes + mins;
  const pct = Math.min(100, Math.round(((todayMinutes + mins) / 120) * 100));
  $("goal-percent").textContent = `${pct}%`;
  $("goal-bar").style.width = `${pct}%`;
  $("today-bar").style.height = `${Math.max(8, Math.min(100, pct))}%`;
  $("progress-ring")?.style?.setProperty("--unused", pct);
}
personalStart.addEventListener("click", () => {
  personalRunning = !personalRunning;
  if (personalRunning) {
    personalInterval = setInterval(() => {
      if (personalSeconds > 0) personalSeconds--;
      if (personalSeconds === 0) {
        personalRunning = false; clearInterval(personalInterval);
        todayMinutes += 25; personalSeconds = 25 * 60;
        toast("Focus session complete — great work!");
      }
      renderPersonal();
    }, 1000);
  } else clearInterval(personalInterval);
  renderPersonal();
});
$("personal-reset").addEventListener("click", () => {
  personalRunning = false; clearInterval(personalInterval); personalSeconds = 25 * 60; renderPersonal();
});
$("display-name").value = localStorage.getItem("studyflow-name") || "";
$("display-name").addEventListener("change", () => localStorage.setItem("studyflow-name", $("display-name").value.trim()));
$("profile-name").textContent = $("display-name").value.trim() || "Student";
$("display-name").addEventListener("input", () => $("profile-name").textContent = $("display-name").value.trim() || "Student");
function displayName() { return $("display-name").value.trim().slice(0,24) || "Student"; }
function randomRoomCode() { return Math.random().toString(36).slice(2,8).toUpperCase(); }
function showRoom(code) {
  $("room-panel").classList.remove("hidden"); $("firebase-hint").classList.add("hidden");
  $("active-room-code").textContent = code;
}
function renderMembers(members = {}) {
  const list = $("members-list"); list.innerHTML = "";
  const entries = Object.entries(members);
  $("member-count").textContent = `${entries.length} member${entries.length === 1 ? "" : "s"}`;
  if (!entries.length) { list.innerHTML = '<li class="empty">No members listed yet.</li>'; return; }
  for (const [id, member] of entries) {
    const li = document.createElement("li");
    const left = document.createElement("span"); left.className = "member-name";
    const bubble = document.createElement("span"); bubble.className = "member-bubble"; bubble.textContent = (member.name || "S").slice(0,1).toUpperCase();
    const name = document.createElement("span"); name.textContent = member.name || "Student";
    left.append(bubble, name);
    const meta = document.createElement("span"); meta.className = "member-meta"; meta.textContent = id === uid ? "YOU · ONLINE" : "● ONLINE";
    li.append(left, meta); list.append(li);
  }
}
function subscribeRoom(code) {
  if (roomUnsubscribe) roomUnsubscribe();
  activeRoom = code; showRoom(code);
  const roomRef = ref(db, `rooms/${code}`);
  roomUnsubscribe = onValue(roomRef, snapshot => {
    const data = snapshot.val();
    if (!data) { toast("Room was not found.", true); return; }
    sharedData = data;
    renderMembers(data.members || {});
    const timer = data.timer || {};
    const remaining = timer.running && timer.endsAt ? Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000)) : (timer.remaining ?? 25*60);
    $("shared-time").textContent = formatTime(remaining);
    $("shared-status").textContent = timer.running ? "Group focus is in progress" : "Waiting to start";
    $("shared-start").textContent = timer.running ? "Ⅱ Pause group focus" : "▶ Start group focus";
    $("firebase-hint").classList.add("hidden");
  }, error => toast(`Room update failed: ${error.message}`, true));
}
async function enterRoom(code, create = false) {
  if (!db || !uid) { toast("First connect Firebase using the README steps.", true); return; }
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,6);
  if (code.length !== 6) { toast("Room code must have 6 characters.", true); return; }
  const roomRef = ref(db, `rooms/${code}`);
  try {
    if (create) {
      await set(roomRef, {
        createdAt: serverTimestamp(),
        timer: { remaining: 1500, running: false, endsAt: null, startedBy: null },
        members: { [uid]: { name: displayName(), joinedAt: serverTimestamp(), online: true } }
      });
    } else {
      // The room's read rule is member-only, so don't fetch the whole room before joining.
      // A valid room code lets the user add their own membership record; then subscribeRoom
      // confirms the room data is readable under the configured database rules.
      await set(ref(db, `rooms/${code}/members/${uid}`), { name: displayName(), joinedAt: serverTimestamp(), online: true });
    }
    await onDisconnect(ref(db, `rooms/${code}/members/${uid}/online`)).set(false);
    subscribeRoom(code);
    toast(create ? "Room created! Share the code with your friends." : "You joined the room!");
  } catch (e) { toast(`Could not join room: ${e.message}`, true); }
}
$("create-room").addEventListener("click", () => enterRoom(randomRoomCode(), true));
$("join-room").addEventListener("click", () => enterRoom($("room-code").value, false));
$("room-code").addEventListener("keydown", e => { if (e.key === "Enter") enterRoom($("room-code").value, false); });
$("copy-room").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(activeRoom); toast("Room code copied!"); }
  catch { toast(`Share this code: ${activeRoom}`); }
});
$("leave-room").addEventListener("click", async () => {
  if (activeRoom && db && uid) {
    try { await set(ref(db, `rooms/${activeRoom}/members/${uid}`), null); } catch {}
  }
  if (roomUnsubscribe) roomUnsubscribe();
  activeRoom = null; sharedData = null; $("room-panel").classList.add("hidden");
  $("firebase-hint").classList.remove("hidden"); toast("You left the room.");
});
$("shared-start").addEventListener("click", async () => {
  if (!activeRoom || !db || !uid || !sharedData) return;
  const timer = sharedData.timer || {};
  if (timer.running) {
    const remaining = Math.max(0, Math.ceil(((timer.endsAt || Date.now()) - Date.now()) / 1000));
    await update(ref(db, `rooms/${activeRoom}/timer`), { running: false, remaining, endsAt: null, updatedAt: serverTimestamp() });
  } else {
    const remaining = timer.remaining ?? 1500;
    await update(ref(db, `rooms/${activeRoom}/timer`), { running: true, remaining, endsAt: Date.now() + remaining*1000, startedBy: uid, updatedAt: serverTimestamp() });
  }
});
$("shared-reset").addEventListener("click", async () => {
  if (!activeRoom || !db || !uid) return;
  await update(ref(db, `rooms/${activeRoom}/timer`), { running: false, remaining: 1500, endsAt: null, updatedAt: serverTimestamp() });
});
setInterval(() => {
  if (activeRoom && sharedData?.timer?.running) {
    const seconds = Math.max(0, Math.ceil(((sharedData.timer.endsAt || Date.now()) - Date.now()) / 1000));
    $("shared-time").textContent = formatTime(seconds);
    if (seconds === 0 && db) update(ref(db, `rooms/${activeRoom}/timer`), { running: false, remaining: 0, endsAt: null });
  }
}, 1000);

if (validFirebaseConfig()) {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app); db = getDatabase(app);
    setConnection(false, "Connecting…");
    signInAnonymously(auth).catch(e => { setConnection(false, "Firebase error"); toast(`Firebase sign-in failed: ${e.message}`, true); });
    onAuthStateChanged(auth, user => {
      if (!user) return;
      uid = user.uid; setConnection(true, "Firebase connected");
      $("firebase-hint").textContent = "Firebase connected. Create a room and share its 6-character code with friends.";
    });
  } catch (e) { setConnection(false, "Firebase setup needed"); }
} else {
  setConnection(false, "Demo mode");
  $("firebase-hint").textContent = "Realtime rooms need Firebase setup. Follow README.md; personal timer works now.";
}
renderPersonal();
