/* pyeditor.js — European School The Hague, ICT S4–S5
 *
 * Drop-in replacement for Trinket embeds. Python runs in the student's own
 * browser tab (Pyodide/WebAssembly); nothing is sent anywhere. Saving writes a
 * real .py file into a folder the student picks once — normally their school
 * OneDrive folder — so the teacher can open the whole set later.
 *
 * Usage in a lesson page:
 *   <link rel="stylesheet" href="pyeditor.css">
 *   <script src="pyeditor.js" defer></script>
 *   ...
 *   <div class="pyeditor" data-task="03-lists" data-unit="S5-Python">
 *     <script type="text/x-python">
 *       # starter code here
 *     </script>
 *   </div>
 */
(function () {
  "use strict";

  var CFG = window.PYEDITOR_CONFIG || {};
  var PYODIDE_URL = CFG.pyodideUrl || "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
  var COURSE = CFG.course || "ICT";
  var SCHOOL = CFG.school || "European School The Hague";
  var LS = "pyed:";

  /* ---------- tiny IndexedDB store (folder handles can't go in localStorage) ---------- */

  function db() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open("pyeditor", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function kv(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var req = fn(d.transaction("kv", mode).objectStore("kv"));
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      });
    });
  }
  var idbGet = function (k) { return kv("readonly", function (s) { return s.get(k); }); };
  var idbSet = function (k, v) { return kv("readwrite", function (s) { return s.put(v, k); }); };

  /* ---------- workspace: the one folder everything is written into ---------- */

  var Workspace = {
    supported: typeof window.showDirectoryPicker === "function",
    dir: null,
    stale: null,
    subs: [],
    on: function (fn) { this.subs.push(fn); fn(); },
    emit: function () { this.subs.forEach(function (f) { f(); }); },

    student: function (name) {
      if (name !== undefined) { localStorage.setItem(LS + "student", name); this.emit(); }
      return localStorage.getItem(LS + "student") || "";
    },

    init: function () {
      var self = this;
      if (!this.supported) { this.emit(); return Promise.resolve(); }
      return idbGet("rootDir").then(function (h) {
        if (!h) return;
        return h.queryPermission({ mode: "readwrite" }).then(function (p) {
          if (p === "granted") self.dir = h; else self.stale = h;
        });
      }).catch(function () { }).then(function () { self.emit(); });
    },

    choose: function () {
      var self = this;
      return window.showDirectoryPicker({ id: "esh-ict", mode: "readwrite" })
        .then(function (h) {
          self.dir = h; self.stale = null;
          return idbSet("rootDir", h);
        })
        .then(function () { self.emit(); return self.dir; });
    },

    reconnect: function () {
      var self = this;
      if (!this.stale) return this.choose();
      return this.stale.requestPermission({ mode: "readwrite" }).then(function (p) {
        if (p !== "granted") return self.choose();
        self.dir = self.stale; self.stale = null; self.emit(); return self.dir;
      });
    },

    ready: function () { return this.dir ? Promise.resolve(this.dir) : (this.stale ? this.reconnect() : this.choose()); },

    folder: function (unit) {
      return this.ready().then(function (root) {
        return unit ? root.getDirectoryHandle(unit, { create: true }) : root;
      });
    },

    write: function (unit, filename, text) {
      return this.folder(unit).then(function (d) {
        return d.getFileHandle(filename, { create: true });
      }).then(function (fh) {
        return fh.createWritable();
      }).then(function (w) {
        return w.write(text).then(function () { return w.close(); });
      });
    },

    read: function (unit, filename) {
      if (!this.dir) return Promise.resolve(null);
      var d = this.dir;
      var step = unit ? d.getDirectoryHandle(unit) : Promise.resolve(d);
      return Promise.resolve(step)
        .then(function (dd) { return dd.getFileHandle(filename); })
        .then(function (fh) { return fh.getFile(); })
        .then(function (f) { return f.text().then(function (t) { return { text: t, at: f.lastModified }; }); })
        .catch(function () { return null; });
    }
  };

  /* ---------- header block written into saved files ---------- */

  var HEADER = /^(?:#: .*\r?\n)+/;

  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function header(task, unit) {
    return [
      "#: " + SCHOOL + " \u2014 " + COURSE + (unit ? " \u2014 " + unit : ""),
      "#: Task: " + task,
      "#: Student: " + (Workspace.student() || "(name not set)"),
      "#: Saved: " + stamp()
    ].join("\n") + "\n\n";
  }
  var strip = function (t) { return t.replace(HEADER, ""); };

  /* ---------- Pyodide, loaded once, on the first Run of the page ---------- */

  var pyPromise = null;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }
  function pyodide() {
    if (!pyPromise) {
      pyPromise = loadScript(PYODIDE_URL + "pyodide.js").then(function () {
        return window.loadPyodide({ indexURL: PYODIDE_URL });
      });
    }
    return pyPromise;
  }

  /* ---------- one editor ---------- */

  function dedent(src) {
    var lines = src.replace(/\t/g, "    ").split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    var pad = lines.reduce(function (m, l) {
      if (!l.trim()) return m;
      return Math.min(m, l.match(/^ */)[0].length);
    }, 999);
    if (pad === 999) pad = 0;
    return lines.map(function (l) { return l.slice(pad); }).join("\n");
  }

  function Editor(el) {
    var self = this;
    this.el = el;
    this.task = el.dataset.task || "untitled";
    this.unit = el.dataset.unit || "";
    this.file = this.task.replace(/[^\w.\- ]+/g, "_") + ".py";
    this.starter = "";

    var src = el.querySelector('script[type="text/x-python"]');
    if (src) { this.starter = dedent(src.textContent); src.remove(); }
    else if (el.textContent.trim()) { this.starter = dedent(el.textContent); }
    el.textContent = "";

    el.className = (el.className + " pyed").replace(/\bpyeditor\b/, "").trim();
    el.innerHTML =
      '<div class="pyed-bar">' +
      '<span class="pyed-task"></span>' +
      '<button class="pyed-btn pyed-btn--run" type="button">Run</button>' +
      '<button class="pyed-btn" type="button" data-a="save">Save</button>' +
      '<button class="pyed-plain" type="button" data-a="reset">Reset</button>' +
      '<span class="pyed-file"><b></b><span class="pyed-state"></span></span>' +
      "</div>" +
      '<div class="pyed-code"><textarea spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></div>' +
      '<pre class="pyed-out" aria-live="polite"></pre>';

    this.$task = el.querySelector(".pyed-task");
    this.$run = el.querySelector(".pyed-btn--run");
    this.$save = el.querySelector('[data-a="save"]');
    this.$reset = el.querySelector('[data-a="reset"]');
    this.$path = el.querySelector(".pyed-file b");
    this.$state = el.querySelector(".pyed-state");
    this.$ta = el.querySelector("textarea");
    this.$out = el.querySelector(".pyed-out");

    this.$task.textContent = this.task;
    this.$ta.style.height = (el.dataset.height || 200) + "px";
    this.$ta.value = this.starter;

    if (window.CodeMirror) {
      this.cm = window.CodeMirror.fromTextArea(this.$ta, {
        mode: "python", lineNumbers: true, indentUnit: 4, tabSize: 4,
        indentWithTabs: false, matchBrackets: true, viewportMargin: Infinity
      });
      this.cm.setSize(null, (el.dataset.height || 200) + "px");
      this.cm.on("change", function () { self.touched(); });
      this.cm.addKeyMap({
        "Ctrl-Enter": function () { self.run(); },
        "Cmd-Enter": function () { self.run(); },
        "Ctrl-S": function () { self.save(); },
        "Cmd-S": function () { self.save(); }
      });
    } else {
      this.$ta.addEventListener("input", function () { self.touched(); });
      this.$ta.addEventListener("keydown", function (e) {
        if (e.key === "Tab") {
          e.preventDefault();
          var s = this.selectionStart;
          this.setRangeText("    ", s, this.selectionEnd, "end");
          self.touched();
        } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); self.run(); }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); self.save(); }
      });
    }

    this.$run.addEventListener("click", function () { self.run(); });
    this.$save.addEventListener("click", function () { self.save(); });
    this.$reset.addEventListener("click", function () {
      if (confirm("Replace your code with the starter code for " + self.task + "?")) {
        self.code(self.starter); self.touched();
      }
    });

    Workspace.on(function () { self.paint(); });
    this.restore();
  }

  Editor.prototype.code = function (v) {
    if (v === undefined) return this.cm ? this.cm.getValue() : this.$ta.value;
    if (this.cm) this.cm.setValue(v); else this.$ta.value = v;
  };

  Editor.prototype.paint = function () {
    var where = Workspace.dir
      ? Workspace.dir.name + "/" + (this.unit ? this.unit + "/" : "") + this.file
      : (this.unit ? this.unit + "/" : "") + this.file;
    this.$path.textContent = where;
    this.$state.textContent = this.dirty ? "not saved" : (this.savedAt ? "saved " + this.savedAt : "");
    this.$state.dataset.s = this.dirty ? "unsaved" : (this.savedAt ? "saved" : "");
  };

  Editor.prototype.touched = function () {
    var self = this;
    this.dirty = true; this.paint();
    clearTimeout(this._t);
    this._t = setTimeout(function () {
      try {
        localStorage.setItem(LS + "code:" + self.unit + "/" + self.task,
          JSON.stringify({ code: self.code(), at: Date.now() }));
      } catch (e) { }
    }, 700);
  };

  /* file wins over the browser draft unless the draft is newer */
  Editor.prototype.restore = function () {
    var self = this, draft = null;
    try { draft = JSON.parse(localStorage.getItem(LS + "code:" + this.unit + "/" + this.task)); } catch (e) { }
    Workspace.read(this.unit, this.file).then(function (f) {
      if (f && (!draft || f.at >= draft.at)) {
        self.code(strip(f.text)); self.dirty = false;
        self.savedAt = new Date(f.at).toLocaleString();
      } else if (draft) {
        self.code(draft.code); self.dirty = true;
        if (f) self.note("Loaded an unsaved draft from this browser, newer than the file. Save to update the file.");
      }
      self.paint();
    });
  };

  Editor.prototype.save = function () {
    var self = this;
    if (!Workspace.supported) return this.download();
    if (!Workspace.student()) {
      var n = prompt("Type your name as it should appear in the file (once only):", "");
      if (n) Workspace.student(n.trim());
    }
    this.$save.disabled = true;
    return Workspace.write(this.unit, this.file, header(this.task, this.unit) + this.code())
      .then(function () {
        self.dirty = false; self.savedAt = stamp(); self.paint();
      })
      .catch(function (e) {
        if (e && e.name === "AbortError") return;
        self.note("Could not save: " + (e && e.message ? e.message : e), true);
      })
      .then(function () { self.$save.disabled = false; });
  };

  Editor.prototype.download = function () {
    var blob = new Blob([header(this.task, this.unit) + this.code()], { type: "text/x-python" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = this.file; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    this.dirty = false; this.savedAt = stamp(); this.paint();
  };

  Editor.prototype.note = function (msg, bad) {
    var s = document.createElement("span");
    s.className = bad ? "err" : "note";
    s.textContent = msg + "\n";
    this.$out.appendChild(s);
    this.$out.scrollTop = this.$out.scrollHeight;
  };

  Editor.prototype.run = function () {
    var self = this;
    var code = this.code();
    this.$out.textContent = "";
    this.$run.disabled = true;
    this.$run.textContent = "Running\u2026";

    var bytes = [];
    var dec = new TextDecoder("utf-8");
    var flush = function () {
      self.$out.textContent = dec.decode(new Uint8Array(bytes));
      self.$out.scrollTop = self.$out.scrollHeight;
    };
    var push = function (str) {
      var b = new TextEncoder().encode(str);
      for (var i = 0; i < b.length; i++) bytes.push(b[i]);
    };

    return pyodide().then(function (py) {
      py.setStdout({ raw: function (c) { bytes.push(c); flush(); } });
      py.setStderr({ raw: function (c) { bytes.push(c); flush(); } });
      py.setStdin({
        stdin: function () {
          var all = dec.decode(new Uint8Array(bytes));
          var label = all.slice(all.lastIndexOf("\n") + 1).trim() || "Input:";
          var v = window.prompt(label, "");
          if (v === null) return null;
          push(v + "\n");
          flush();
          return v + "\n";
        }
      });
      return py.loadPackagesFromImports(code)
        .catch(function () { })
        .then(function () { return py.runPythonAsync(code); })
        .catch(function (e) {
          var msg = (e && e.message) ? e.message : String(e);
          var span = document.createElement("span");
          span.className = "err";
          span.textContent = "\n" + msg.replace(/\s*File "\/lib\/python[^\n]*\n[^\n]*\n/g, "");
          self.$out.appendChild(span);
          self.$out.scrollTop = self.$out.scrollHeight;
        });
    }).catch(function (e) {
      self.note("Python could not start: " + (e && e.message ? e.message : e), true);
    }).then(function () {
      self.$run.disabled = false;
      self.$run.textContent = "Run";
      if (!self.$out.textContent) self.note("Finished. No output.");
    });
  };

  /* ---------- workspace chip ---------- */

  function chip() {
    var box = document.createElement("div");
    box.className = "pyed-ws";
    document.body.appendChild(box);

    Workspace.on(function () {
      var who = Workspace.student();
      if (!Workspace.supported) {
        box.dataset.ready = "0";
        box.innerHTML = '<b>Saving</b><div>This browser cannot write straight to a folder. ' +
          'Save downloads the .py file \u2014 move it into your OneDrive folder afterwards. ' +
          'Use Edge or Chrome to avoid this.</div>';
        return;
      }
      if (!Workspace.dir) {
        box.dataset.ready = "0";
        box.innerHTML = '<b>Folder for your work</b><div>Not chosen yet \u2014 nothing can be saved.</div>' +
          '<div class="row"><button class="pyed-btn" type="button" data-a="pick">Choose folder</button></div>';
      } else {
        box.dataset.ready = "1";
        box.innerHTML = '<b>Saving to</b><div class="path">' + Workspace.dir.name + "</div>" +
          '<div class="row"><span>' + (who ? who : "Name not set") + "</span>" +
          '<button class="pyed-plain" type="button" data-a="name">' + (who ? "change" : "set name") + "</button>" +
          '<button class="pyed-plain" type="button" data-a="pick">change folder</button></div>';
      }
      var pick = box.querySelector('[data-a="pick"]');
      if (pick) pick.onclick = function () { Workspace.choose().catch(function () { }); };
      var nm = box.querySelector('[data-a="name"]');
      if (nm) nm.onclick = function () {
        var n = prompt("Your name, as it should appear in every saved file:", who);
        if (n !== null) Workspace.student(n.trim());
      };
    });
  }

  /* ---------- go ---------- */

  function start() {
    var nodes = document.querySelectorAll(".pyeditor, .pyed[data-task]");
    if (!nodes.length) return;
    Workspace.init().then(function () {
      Array.prototype.forEach.call(nodes, function (n) {
        if (!n._pyed) n._pyed = new Editor(n);
      });
      chip();
    });
    window.addEventListener("beforeunload", function (e) {
      var d = Array.prototype.some.call(document.querySelectorAll(".pyed"), function (n) {
        return n._pyed && n._pyed.dirty;
      });
      if (d) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.PyEditor = { Workspace: Workspace };
})();
