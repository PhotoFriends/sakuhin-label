import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const EMAIL_DOMAIN = "sakuhin-label.app";
const COMMENT_MAX_LINES = 2;
const $ = (s, r = document) => r.querySelector(s);

// ---------------- storage backends ----------------
// Firebase (Auth + Firestore). With ?local (or no config) a localStorage
// stand-in is used so the page can be tried without the network.
async function firebaseBackend() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(FB + "firebase-app.js"),
    import(FB + "firebase-auth.js"),
    import(FB + "firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  const db = fs.getFirestore(app);
  const col = (uid) => fs.collection(db, "users", uid, "labels");
  return {
    onUser: (cb) => auth.onAuthStateChanged(a, (u) => cb(u && { uid: u.uid, name: u.email.split("@")[0] })),
    signup: (user, pass) => auth.createUserWithEmailAndPassword(a, `${user}@${EMAIL_DOMAIN}`, pass),
    login: (user, pass) => auth.signInWithEmailAndPassword(a, `${user}@${EMAIL_DOMAIN}`, pass),
    logout: () => auth.signOut(a),
    async getProfile(uid) { const d = await fs.getDoc(fs.doc(db, "users", uid)); return d.exists() ? d.data() : null; },
    saveProfile: (uid, p) => fs.setDoc(fs.doc(db, "users", uid), p),
    async list(uid) {
      const snap = await fs.getDocs(fs.query(col(uid), fs.orderBy("order")));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    save: (uid, l) => { const { id, ...data } = l; return fs.setDoc(fs.doc(col(uid), id), data); },
    remove: (uid, id) => fs.deleteDoc(fs.doc(col(uid), id)),
  };
}

function localBackend() {
  const key = "sakuhin-label-local";
  const read = () => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
  const write = (o) => localStorage.setItem(key, JSON.stringify(o));
  let cb = () => {};
  const emit = () => { const s = read(); cb(s.current ? { uid: s.current, name: s.current } : null); };
  return {
    onUser: (f) => { cb = f; emit(); },
    async signup(user, pass) {
      const s = read(); s.users ??= {};
      if (s.users[user]) throw { code: "auth/email-already-in-use" };
      s.users[user] = { pass, labels: {} }; s.current = user; write(s); emit();
    },
    async login(user, pass) {
      const s = read();
      if (!s.users?.[user] || s.users[user].pass !== pass) throw { code: "auth/invalid-credential" };
      s.current = user; write(s); emit();
    },
    async logout() { const s = read(); delete s.current; write(s); emit(); },
    async getProfile(uid) { return read().users[uid].profile || null; },
    async saveProfile(uid, p) { const s = read(); s.users[uid].profile = p; write(s); },
    async list(uid) { return Object.values(read().users[uid].labels).sort((a, b) => a.order - b.order); },
    async save(uid, l) { const s = read(); s.users[uid].labels[l.id] = l; write(s); },
    async remove(uid, id) { const s = read(); delete s.users[uid].labels[id]; write(s); },
  };
}

const useLocal = !firebaseConfig || new URLSearchParams(location.search).has("local");
const store = useLocal ? localBackend() : await firebaseBackend();

// ---------------- state ----------------
let me = null;
let profile = null;
let labels = [];

const VIEWS = ["authView", "profileView", "listView", "formView"];
function show(id) {
  VIEWS.forEach((v) => ($("#" + v).hidden = v !== id));
  scrollTo(0, 0);
  if (id === "listView") renderList();
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nameLine = (p) => p ? [p.grade && `${p.grade}年`, p.sei, p.mei].filter(Boolean).join("　") : "";
const toHalf = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// ---------------- label rendering ----------------
function labelHTML(p, l) {
  return `<div class="label">
    <div class="c-name">${esc(nameLine(p))}</div>
    <div class="c-title">『${esc(l.title)}』</div>
    <div class="c-comment"><div class="cm">${esc((l.comment || "").replace(/\s+$/, ""))}</div></div>
    <div class="c-photo">${l.photo ? `<img src="${l.photo}" alt="">` : ""}</div>
  </div>`;
}

// Labels are laid out at their real printed size (pt); on screen they are scaled to the box width.
const LABEL_PX = 538.58 * 4 / 3;
const fitObserver = new ResizeObserver((entries) => entries.forEach((e) => fitOne(e.target)));
function fitOne(box) {
  const z = Math.min(1.35, box.clientWidth / LABEL_PX);
  box.querySelectorAll(".label").forEach((l) => (l.style.zoom = z));
}
function makeFit(box) { fitObserver.observe(box); fitOne(box); }

// Overflow check against the fixed label width, using an unscaled off-screen copy.
function checkFit(p, l) {
  const m = $("#measure");
  m.innerHTML = labelHTML(p, l);
  const name = $(".c-name", m), title = $(".c-title", m), cm = $(".cm", m);
  const lh = parseFloat(getComputedStyle(cm).lineHeight);
  return {
    name: name.scrollWidth > name.clientWidth + 0.5,
    title: title.scrollWidth > title.clientWidth + 0.5,
    commentLines: l.comment?.trim() ? Math.round(cm.getBoundingClientRect().height / lh) : 0,
  };
}

// ---------------- auth ----------------
let mode = "login";
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  mode = b.dataset.mode;
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
  $("#pass2Wrap").hidden = mode !== "signup";
  $("#authPass").autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("#authSubmit").textContent = mode === "signup" ? "登録する" : "ログイン";
  $("#authMsg").textContent = "";
}));

const AUTH_ERR = {
  "auth/email-already-in-use": "そのユーザー名は使われています",
  "auth/invalid-credential": "ユーザー名かパスワードが違います",
  "auth/wrong-password": "ユーザー名かパスワードが違います",
  "auth/user-not-found": "ユーザー名かパスワードが違います",
  "auth/weak-password": "パスワードは6文字以上にしてください",
  "auth/too-many-requests": "しばらく待ってからもう一度試してください",
  "auth/network-request-failed": "通信できませんでした",
  "auth/operation-not-allowed": "登録の受付が設定されていません（管理者に連絡してください）",
};

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = $("#authUser").value.trim().toLowerCase();
  const pass = $("#authPass").value;
  const msg = $("#authMsg");
  if (!/^[a-z0-9_.-]{3,20}$/.test(user)) { msg.textContent = "ユーザー名は半角英数字（3〜20文字）にしてください"; return; }
  if (pass.length < 6) { msg.textContent = "パスワードは6文字以上にしてください"; return; }
  if (mode === "signup" && pass !== $("#authPass2").value) { msg.textContent = "パスワードが一致しません"; return; }
  msg.textContent = "";
  $("#authSubmit").disabled = true;
  try { await (mode === "signup" ? store.signup(user, pass) : store.login(user, pass)); }
  catch (err) { msg.textContent = AUTH_ERR[err.code] || "エラーが発生しました"; console.error(err); }
  finally { $("#authSubmit").disabled = false; }
});

$("#logoutBtn").addEventListener("click", () => store.logout());

store.onUser(async (u) => {
  me = u;
  $("#barRight").hidden = !u;
  if (!u) { profile = null; labels = []; $("#authPass").value = ""; $("#authPass2").value = ""; show("authView"); return; }
  $("#who").textContent = u.name;
  try {
    [profile, labels] = await Promise.all([store.getProfile(u.uid), store.list(u.uid)]);
  } catch (e) {
    console.error(e);
    alert("読み込めませんでした。通信を確認して再読み込みしてください。");
    return;
  }
  if (!profile) openProfile(true); else show("listView");
});

// ---------------- profile ----------------
function openProfile(first) {
  $("#pGrade").value = profile?.grade || "";
  $("#pSei").value = profile?.sei || "";
  $("#pMei").value = profile?.mei || "";
  $("#profileCancel").hidden = first;
  $("#profileMsg").textContent = "";
  updateNamePreview();
  show("profileView");
}
const readProfile = () => ({ grade: toHalf($("#pGrade").value.trim()), sei: $("#pSei").value.trim(), mei: $("#pMei").value.trim() });
function updateNamePreview() { $("#pPreview").textContent = nameLine(readProfile()); }
["#pGrade", "#pSei", "#pMei"].forEach((s) => $(s).addEventListener("input", updateNamePreview));
$("#profileBtn").addEventListener("click", () => openProfile(false));
$("#profileCancel").addEventListener("click", () => show("listView"));

$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = readProfile();
  const msg = $("#profileMsg");
  if (!/^\d{1,2}$/.test(p.grade)) { msg.textContent = "学年は数字で入力してください"; return; }
  if (!p.sei || !p.mei) { msg.textContent = "姓と名を入力してください"; return; }
  if (checkFit(p, { title: "" }).name) { msg.textContent = "氏名が長すぎてラベルに収まりません"; return; }
  const btn = e.submitter; btn.disabled = true;
  try { await store.saveProfile(me.uid, p); profile = p; show("listView"); }
  catch (err) { console.error(err); msg.textContent = "保存できませんでした"; }
  finally { btn.disabled = false; }
});

// ---------------- list ----------------
function renderList() {
  const box = $("#labels");
  if (!labels.length) {
    box.innerHTML = `<div class="empty">まだ作品がありません。「＋ 作品を提出」から追加してください。</div>`;
    $("#printBtn").disabled = true;
    return;
  }
  $("#printBtn").disabled = false;
  box.innerHTML = "";
  labels.forEach((l, i) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div class="ops">
        <button data-op="up" ${i === 0 ? "disabled" : ""} title="上へ">↑</button>
        <button data-op="down" ${i === labels.length - 1 ? "disabled" : ""} title="下へ">↓</button>
        <button data-op="edit">編集</button>
        <button data-op="del">削除</button>
      </div>
      <div class="fit">${labelHTML(profile, l)}</div>`;
    item.querySelector(".ops").addEventListener("click", (e) => onOp(e, l, i));
    box.append(item);
    makeFit(item.querySelector(".fit"));
  });
}

async function onOp(e, l, i) {
  const b = e.target.closest("button");
  if (!b) return;
  const op = b.dataset.op;
  if (op === "edit") return openForm(l);
  if (op === "up" || op === "down") {
    const j = op === "up" ? i - 1 : i + 1;
    const other = labels[j];
    [l.order, other.order] = [other.order, l.order];
    [labels[i], labels[j]] = [labels[j], labels[i]];
    renderList();
    Promise.all([store.save(me.uid, l), store.save(me.uid, other)]).catch((err) => { console.error(err); alert("並べ替えを保存できませんでした"); });
    return;
  }
  if (op === "del") {
    if (!b.classList.contains("armed")) {
      b.classList.add("armed"); b.textContent = "本当に削除";
      setTimeout(() => { b.classList.remove("armed"); b.textContent = "削除"; }, 3000);
      return;
    }
    b.disabled = true;
    try { await store.remove(me.uid, l.id); labels.splice(labels.indexOf(l), 1); renderList(); }
    catch (err) { console.error(err); alert("削除できませんでした"); b.disabled = false; }
  }
}

$("#addBtn").addEventListener("click", () => openForm(null));

// ---------------- work form ----------------
let editing = null;   // label being edited, or null for a new one
let draft = null;     // { title, comment, photo }

function openForm(l) {
  editing = l;
  draft = { title: l?.title || "", comment: l?.comment || "", photo: l?.photo || "" };
  $("#formTitle").textContent = l ? "作品を編集" : "作品を提出";
  $("#formSubmit").textContent = l ? "保存" : "提出";
  $("#wTitle").value = draft.title;
  $("#wComment").value = draft.comment;
  $("#wPhoto").value = "";
  $("#photoName").textContent = draft.photo ? "選択済み" : "";
  $("#formMsg").textContent = "";
  $("#photoWarn").textContent = "";
  show("formView");
  makeFit($("#formPreview"));
  validate();
  $("#wTitle").focus();
}
$("#formCancel").addEventListener("click", () => show("listView"));

function validate() {
  const f = checkFit(profile, draft);
  const tw = $("#titleWarn"), cw = $("#commentWarn");
  tw.textContent = f.title ? "タイトルが長すぎてラベルの幅に収まりません。短くしてください（全角25文字程度まで）。" : "";
  cw.textContent = f.commentLines > COMMENT_MAX_LINES
    ? `コメントが${f.commentLines}行になり、ラベルに収まりません。${COMMENT_MAX_LINES}行（全角47文字×${COMMENT_MAX_LINES}行程度）までにしてください。`
    : "";
  $("#wTitle").classList.toggle("bad", f.title);
  $("#wComment").classList.toggle("bad", f.commentLines > COMMENT_MAX_LINES);

  const pv = $("#formPreview");
  pv.innerHTML = labelHTML(profile, draft);
  $(".c-title", pv).classList.toggle("over", f.title);
  $(".c-comment", pv).classList.toggle("over", f.commentLines > COMMENT_MAX_LINES);
  fitOne(pv);
  return !f.title && f.commentLines <= COMMENT_MAX_LINES;
}

$("#wTitle").addEventListener("input", (e) => { draft.title = e.target.value; validate(); });
$("#wComment").addEventListener("input", (e) => { draft.comment = e.target.value; validate(); });
$("#wPhoto").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $("#photoWarn").textContent = "";
  $("#photoName").textContent = "読み込み中…";
  try {
    draft.photo = await shrink(f, 1200, 0.85);
    $("#photoName").textContent = f.name;
    validate();
  } catch (err) {
    console.error(err);
    $("#photoName").textContent = "";
    $("#photoWarn").textContent = "この画像は読み込めませんでした。JPEGかPNGでお試しください。";
  }
});

$("#workForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  draft.title = draft.title.trim();
  const msg = $("#formMsg");
  const ok = validate();
  if (!draft.title) { msg.textContent = "作品のタイトルを入力してください"; return; }
  if (!draft.photo) { msg.textContent = "作品の写真を選んでください"; return; }
  if (!ok) { msg.textContent = "ラベルに収まらない項目があります（赤い部分）"; return; }
  msg.textContent = "";
  const l = editing
    ? Object.assign(editing, draft)
    : { id: newId(), order: (labels.at(-1)?.order ?? -1) + 1, ...draft };
  const btn = $("#formSubmit"); btn.disabled = true;
  try {
    await store.save(me.uid, l);
    if (!editing) labels.push(l);
    show("listView");
  } catch (err) {
    console.error(err);
    msg.textContent = "保存できませんでした。通信を確認してもう一度押してください。";
  } finally { btn.disabled = false; }
});

// Downscale so each label stays well under Firestore's 1 MB document limit.
// Drawing an <img> applies the EXIF orientation, so sideways phone shots come out upright.
function shrink(file, max, q) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL("image/jpeg", q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); };
    img.src = url;
  });
}

// ---------------- print ----------------
function buildPrint() { $("#printArea").innerHTML = labels.map((l) => labelHTML(profile, l)).join(""); }

$("#printBtn").addEventListener("click", async () => {
  buildPrint();
  await Promise.all([...document.querySelectorAll("#printArea img")].map((i) => i.decode().catch(() => {})));
  const prev = document.title;
  document.title = `作品ラベル_${nameLine(profile).replace(/　/g, "")}`;
  window.print();
  document.title = prev;
});
window.addEventListener("beforeprint", buildPrint);
