var localbus = {
  dt: {
    bool: 1,
    bit2: 2,
    bit4: 3,
    char: 4,
    uint8: 5,
    int8: 6,
    uint16: 7,
    int16: 8,
    float16: 9,
    time: 10,
    date: 11,
    uint32: 12,
    int32: 13,
    float32: 14,
    access: 15,
    string: 16,
    int64: 29,
    uint24: 232,
    text: 255,
    enum: 20,
    combinedonoff: 27001,
    dalidiag: 238600,
    dalitestresult: 245600,
    dalibrct: 250600,
    dalirgbw: 251600
  },
  mdt: {
    scale: 1,
    hex: 2,
    angle: 3
  },
  listeners: {
    alerts: [],
    storage: {},
    storagemask: {},
    object: {},
    groupwrite: [],
    groupread: [],
    groupresponse: [],
    groupinit: [],
    state: []
  },
  dpts: {},
  storage: {},
  params: null as unknown,
  objectstore: {},
  inittimer: null as unknown as NodeJS.Timeout,
  callbacks: null as unknown
  
  setcallbacks: function(t: () => unknown) {
    this.params.callbacks = t
  },
  setstoragekeys: function(t: Object) {
    this.params.storage = JSON.stringify(t)
  },
  setstate: function(t: unknown) {
    var thisObject = this;
    thisObject.each(thisObject.listeners.state, (function(e, i) {
      i(t)
    }
    )),
    window.jQuery && jQuery(thisObject).trigger(t ? "connect" : "disconnect")
  },
  each: function(t: { [key: string]: unknown }, e: (param1: unknown, param2: unknown) => unknown) {
    var i;
    for (i in t)
      e(i, t[i as string])
  },
  getparams: function() {
    var t = [] as unknown[];
    return this.each(this.params, (function(e, i) {
      t.push(encodeURIComponent(e) + "=" + encodeURIComponent(i))
    }
    )),
    t.join("&")
  },
  onerror: function() {
    var thisObject = this;
    clearTimeout(thisObject.inittimer),
    thisObject.inittimer = setTimeout((function() {
      thisObject.init()
    }
    ), 1e3)
  },
  onvisibilitychange: function() {
    !document.hidden && this.ws && this.ws.send("ping")
  },
  init: function(t?, e?) {
    var i, s, n, a, r = this;
    r.visibilitychange || (r.visibilitychange = r.onvisibilitychange.bind(r),
    document.addEventListener("visibilitychange", r.visibilitychange, !1)),
    r.base || (t ? r.base = t : (i = window.location,
    r.base = i.protocol + "//" + i.host),
    r.base += "/apps/localbus.lp",
    r.wsbase = "ws" + r.base.substr(4),
    r.headers = {},
    e && (r.headers.Authorization = "Basic " + btoa(e))),
    s = r.base + "?" + r.getparams(),
    n = new AbortController,
    a = setTimeout((function() {
      n.abort()
    }
    ), 3e4),
    fetch(s, {
      method: "POST",
      body: "",
      headers: r.headers,
      signal: n.signal
    }).then((function(t) {
      if (t.ok)
        return t.json();
      throw "request failed"
    }
    )).then((function(t) {
      r.register(t),
      r.start(t.auth)
    }
    )).catch((function(t) {
      r.onerror()
    }
    )).finally((function() {
      clearTimeout(a)
    }
    ))
  },
  register: function(t) {
    var e = this;
    e.each(t.storage, (function(t, i) {
      e.storage[t] = i,
      e.run("storage", t, i)
    }
    )),
    e.each(t.objects, (function(t, i) {
      var s, n, a = i.id;
      e.registerdpt(i),
      void 0 !== (s = e.decode(a, i.datahex)) && (i.value = s,
      e.objectstore[a] = i,
      e.run("object", a, s, i),
      n = e.decodega(a),
      e.each(e.listeners.groupinit, (function(t, e) {
        e(n, s, i)
      }
      )))
    }
    ))
  },
  log: function(t) {
    window.console && window.console.timeStamp && console.timeStamp(t)
  },
  start: function(t) {
    var e, i = this;
    t ? i.params.auth = t : delete i.params.auth,
    (e = new WebSocket(i.wsbase + "?" + i.getparams())).onopen = function() {
      i.ws = e,
      i.wdt = setInterval((function() {
        i.ws && i.ws.send("ping")
      }
      ), 1e4),
      i.setstate(!0)
    }
    ,
    e.onmessage = function(t) {
      var e, s, n, a, r, o;
      try {
        e = JSON.parse(t.data)
      } catch (t) {
        e = {}
      }
      "object" == typeof e && e.type && ("storage" == (s = e.type) ? i.run(s, e.key, e.data) : "alert" == s ? i.each(i.listeners.alerts, (function(t, i) {
        i(e.source, e.alert)
      }
      )) : "groupwrite" != s && "groupresponse" != s || (a = e.dstraw,
      void 0 !== (r = i.decode(a, e.datahex)) && (e.value = r,
      (o = i.objectstore[a]) && (o.value = r,
      o.datahex = e.datahex,
      o.updatetime = e.tsec + e.tusec / 1e6),
      i.run("object", a, r, o))),
      0 == s.indexOf("group") && (n = i.listeners[s]) && i.each(n, (function(t, i) {
        i(e)
      }
      )))
    }
    ,
    e.onerror = function() {
      i.log("error")
    }
    ,
    e.onclose = function() {
      i.log("close"),
      i.ws = null,
      clearInterval(i.wdt),
      i.setstate(!1),
      i.onerror()
    }
  },
  encodega: function(t) {
    var e, i, s, n = t.split("/"), a = !1;
    return 2 == n.length ? (e = parseInt(n[0], 10),
    i = parseInt(n[1], 10),
    isNaN(e) || isNaN(i) || (a = (63 & e) << 11 | 2047 & i)) : 3 == n.length && (e = parseInt(n[0], 10),
    i = parseInt(n[1], 10),
    s = parseInt(n[2], 10),
    isNaN(e) || isNaN(i) || isNaN(s) || (a = (63 & e) << 11 | (7 & i) << 8 | 255 & s)),
    a
  },
  decodega: function(t) {
    var e = parseInt(t, 10) || 0;
    return [e >> 11 & 63, e >> 8 & 7, 255 & e].join("/")
  },
  normalizedpt: function(t) {
    var e = 0
      , i = Math.floor(parseInt(t, 10) || 0)
      , s = i % 1
      , n = i;
    return i >= 1e3 ? (e = i % 1e3,
    i = Math.floor(i / 1e3)) : s && (e = Math.floor(1e3 * s)),
    {
      raw: n,
      minor: e,
      major: i
    }
  },
  registerdpt: function(t) {
    this.dpts[t.id] = this.normalizedpt(t.datatype)
  },
  decode: function(t, e) {
    var i = this.dpts[t];
    if (i)
      return busdecode(e, i, t, this.dt, this.mdt)
  },
  getvalue: function(t) {
    var e, i = this.encodega(t);
    if (i && (e = this.objectstore[i]))
      return e.value
  },
  run: function(t, e, i, s) {
    var n = this
      , a = this.listeners[t][e];
    a && n.each(a, (function(t, e) {
      e(i, s)
    }
    )),
    "storage" == t && n.each(this.listeners.storagemask, (function(t, s) {
      0 == e.indexOf(t) && n.each(s, (function(t, s) {
        s(e, i)
      }
      ))
    }
    ))
  },
  setidlistener: function(t, e, i, s) {
    var n, a = this.listeners[t][e];
    if (a || (a = [],
    this.listeners[t][e] = a),
    s) {
      if (a.push(i),
      this[t])
        return this[t][e]
    } else
      (n = a.indexOf(i)) >= 0 && a.splice(n, 1)
  },
  setlistener: function(t, e, i) {
    var s, n = this.listeners[t];
    i ? n.push(e) : (s = n.indexOf(e)) >= 0 && n.splice(s, 1)
  },
  setlisten: function(t, e, i, s) {
    var n, a;
    "storage" == t ? e.indexOf("*") >= 0 ? (e = e.substr(0, e.length - 1),
    this.setidlistener(t + "mask", e, i, s),
    s && this.each(this.storage, (function(t, s) {
      0 == t.indexOf(e) && i(t, s)
    }
    ))) : n = this.setidlistener(t, e, i, s) : "alerts" == t || "state" == t ? (i = e,
    this.setlistener(t, i, s)) : "object" == t ? (e = this.encodega(e)) && (this.setidlistener(t, e, i, s),
    (a = this.objectstore[e]) && (n = a.value)) : 0 == t.indexOf("group") && this.listeners[t] && (i = e,
    this.setlistener(t, i, s)),
    s && void 0 !== n && i(n, a)
  },
  listen: function(t, e, i) {
    this.setlisten(t, e, i, !0)
  },
  unlisten: function(t, e, i) {
    this.setlisten(t, e, i, !1)
  },
  send: function(t) {
    var e;
    if (this.ws) {
      t = JSON.stringify(t);
      try {
        e = this.ws.send(t)
      } catch (t) {
        e = !1
      }
    }
    return e
  },
  write: function(t, e, i) {
    var s, n = this.encodega(t) || 0, a = this.dpts[n];
    return a && (s = this.send({
      action: i ? "update" : "write",
      address: n,
      datatype: a.raw,
      value: e
    })),
    s
  },
  update: function(t, e) {
    return this.write(t, e, !0)
  },
  read: function(t) {
    var e, i = this.encodega(t) || 0;
    return i && (e = this.send({
      action: "read",
      address: i
    })),
    e
  },
  stop: function() {
    this.inittimer && (clearTimeout(this.inittimer),
    this.inittimer = null),
    this.ws && (this.ws.onclose = void 0,
    this.ws.close(),
    this.ws = null),
    this.visibilitychange && (document.removeEventListener("visibilitychange", this.visibilitychange, !1),
    this.visibilitychange = void 0)
  }
};

localbus.init()