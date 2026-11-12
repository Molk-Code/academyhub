// Room display logic (was inline in display.html; a file so the
// Content-Security-Policy needs no 'unsafe-inline' for scripts).
    import { initializeApp }                       from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'
    import { getFirestore, collection, query,
             where, onSnapshot, doc }              from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'

    // ── Firebase ─────────────────────────────────────────────────────────────
    const app = initializeApp({
      apiKey:            '%VITE_FIREBASE_API_KEY%',
      authDomain:        '%VITE_FIREBASE_AUTH_DOMAIN%',
      projectId:         '%VITE_FIREBASE_PROJECT_ID%',
      storageBucket:     '%VITE_FIREBASE_STORAGE_BUCKET%',
      messagingSenderId: '%VITE_FIREBASE_MESSAGING_SENDER_ID%',
      appId:             '%VITE_FIREBASE_APP_ID%',
    })
    const db = getFirestore(app)

    // ── Screen Wake Lock ─────────────────────────────────────────────────────
    const dot = document.getElementById('wakelock-dot')
    let wakeLock = null

    async function acquireWakeLock() {
      if (!('wakeLock' in navigator)) return
      try {
        wakeLock = await navigator.wakeLock.request('screen')
        dot.classList.add('active')
        wakeLock.addEventListener('release', () => {
          dot.classList.remove('active')
          wakeLock = null
        })
      } catch {}
    }

    acquireWakeLock()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !wakeLock) acquireWakeLock()
    })

    // ── Helpers ──────────────────────────────────────────────────────────────
    function todayStr()  { return fmtDate(new Date()) }
    function todayDay()  { return new Date().getDay() }

    function fmtDate(d)  {
      return d.getFullYear() + '-' +
        String(d.getMonth()+1).padStart(2,'0') + '-' +
        String(d.getDate()).padStart(2,'0')
    }

    function fmtTime(d) {
      return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0')
    }

    function fmtDateLong(d) {
      const days  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      const months= ['January','February','March','April','May','June','July','August','September','October','November','December']
      return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear()
    }

    function parseMinutes(t) { const [h,m] = t.split(':').map(Number); return h*60+m }
    function nowMinutes()    { const n = new Date(); return n.getHours()*60+n.getMinutes() }

    function slotStatus(slot) {
      const n = nowMinutes(), s = parseMinutes(slot.startTime), e = parseMinutes(slot.endTime)
      if (n >= e) return 'past'
      if (n >= s) return 'current'
      return 'upcoming'
    }

    function bookingKey(slot, date, roomId) {
      return slot.startTime + '_' + slot.endTime + '_' + date + '_' + roomId
    }

    function deriveSlots(rooms, todayS, todayDayN) {
      const seen = new Map()
      for (const room of rooms) {
        for (const w of (room.availability ?? [])) {
          if (w.days.includes(todayDayN) && todayS >= w.startDate && todayS <= w.endDate) {
            const k = w.startTime + '_' + w.endTime
            if (!seen.has(k)) seen.set(k, { startTime: w.startTime, endTime: w.endTime })
          }
        }
      }
      return [...seen.values()].sort((a,b) => a.startTime.localeCompare(b.startTime))
    }

    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    }

    // ── State ────────────────────────────────────────────────────────────────
    const params    = new URLSearchParams(location.search)
    const urlRoom   = params.get('room')   // optional URL hint for initial room
    let activeRoomId = null                // null = overview, otherwise room.id
    let rooms    = []
    let bookings = []
    let now      = new Date()

    // ── Nav bar ───────────────────────────────────────────────────────────────
    function renderNav() {
      const nav = document.getElementById('room-nav')
      const sortedRooms = [...rooms].sort((a,b) => (a.order??0)-(b.order??0))
      if (sortedRooms.length < 2) { nav.classList.remove('visible'); return }

      const today  = todayStr()
      const dayNum = todayDay()
      const slots  = deriveSlots(sortedRooms, today, dayNum)
      const bmap   = new Map()
      for (const b of bookings) {
        if (b.startTime && b.endTime) bmap.set(bookingKey(b, b.date, b.roomId), b)
      }

      // Determine current status per room (for indicator dot)
      function roomStatus(room) {
        const curSlot = slots.find(s => slotStatus(s) === 'current')
        if (!curSlot) return 'free'
        return bmap.has(bookingKey(curSlot, today, room.id)) ? 'taken' : 'free'
      }

      const overviewActive = activeRoomId === null
      nav.innerHTML = `
        <button class="nav-btn overview-btn${overviewActive ? ' active' : ''}" data-room-id="">
          ⊞ Overview
        </button>
        ${sortedRooms.map(r => {
          const st  = roomStatus(r)
          const act = activeRoomId === r.id
          return `<button class="nav-btn${act ? ` active ${st}` : ''}" data-room-id="${esc(r.id)}">
            <span class="nav-dot ${st}"></span>${esc(r.name)}
          </button>`
        }).join('')}
      `
      nav.classList.add('visible')

      nav.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          activeRoomId = btn.dataset.roomId || null
          render()
        })
      })
    }

    // ── Render ───────────────────────────────────────────────────────────────
    function render() {
      now = new Date()
      const app    = document.getElementById('app')
      const today  = todayStr()
      const dayNum = todayDay()

      const sortedRooms = [...rooms].sort((a,b) => (a.order??0)-(b.order??0))
      const slots       = deriveSlots(sortedRooms, today, dayNum)

      const bmap = new Map()
      for (const b of bookings) {
        if (b.startTime && b.endTime) bmap.set(bookingKey(b, b.date, b.roomId), b)
      }

      renderNav()

      if (activeRoomId) {
        const room = sortedRooms.find(r => r.id === activeRoomId)
        if (room) { app.innerHTML = renderSingle(room, slots, bmap, today); return }
      }
      app.innerHTML = renderAll(sortedRooms, slots, bmap, today)
    }

    // ── Single-room view ─────────────────────────────────────────────────────
    function renderSingle(room, slots, bmap, today) {
      const curSlot  = slots.find(s => slotStatus(s) === 'current')
      const curBook  = curSlot ? bmap.get(bookingKey(curSlot, today, room.id)) : null
      const isFree   = !curBook

      let bannerHtml = ''
      if (curSlot) {
        bannerHtml = `
          <div class="now-banner ${isFree ? 'free' : 'taken'}">
            <div>
              <div class="now-label">Now · ${esc(curSlot.startTime)}–${esc(curSlot.endTime)}</div>
              <div class="now-name">${isFree ? 'AVAILABLE' : esc(curBook.studentName)}</div>
            </div>
            <div class="now-badge">${isFree ? 'FREE' : 'OCCUPIED'}</div>
          </div>`
      }

      const slotsHtml = slots.length === 0
        ? '<p class="no-slots">No bookings scheduled today.</p>'
        : slots.filter(s => slotStatus(s) !== 'current').map(slot => {
            const st  = slotStatus(slot)
            const bk  = bmap.get(bookingKey(slot, today, room.id))
            const cls = st === 'past'
              ? 'past'
              : bk ? 'upcoming-taken' : 'upcoming-free'
            return `
              <div class="slot-row ${cls}">
                <div class="slot-time">
                  <div class="t-start">${esc(slot.startTime)}</div>
                  <div class="t-end">${esc(slot.endTime)}</div>
                </div>
                <div class="slot-who">
                  ${bk
                    ? `<div class="name">${esc(bk.studentName)}</div>`
                    : `<div class="avail">Available</div>`}
                </div>
                ${st !== 'past' ? `<div class="slot-badge">${bk ? 'TAKEN' : 'FREE'}</div>` : ''}
              </div>`
          }).join('')

      return `
        <div class="header">
          <div class="header-left">
            <div class="date-label">${esc(fmtDateLong(now))}</div>
            <div class="room-name">${esc(room.name.toUpperCase())}</div>
            ${room.description ? `<div class="room-desc">${esc(room.description)}</div>` : ''}
          </div>
          <div class="header-right">
            <div class="clock">${esc(fmtTime(now))}</div>
            <div class="tz">Local time</div>
          </div>
        </div>
        ${bannerHtml}
        <div class="slots">${slotsHtml}</div>`
    }

    // ── All-rooms grid view ──────────────────────────────────────────────────
    function renderAll(sortedRooms, slots, bmap, today) {
      if (slots.length === 0) {
        return `
          <div class="grid-header">
            <div><div class="grid-title">ROOM BOOKINGS</div><div class="grid-date">${esc(fmtDateLong(now))}</div></div>
            <div class="grid-clock">${esc(fmtTime(now))}</div>
          </div>
          <div class="grid-body"><p class="no-slots">No bookings scheduled today.</p></div>
          <div class="grid-footer">Updates in real time · CineForge</div>`
      }

      const roomThs = sortedRooms.map(r => `<th class="room-th">${esc(r.name)}</th>`).join('')

      const rowsHtml = slots.map(slot => {
        const st  = slotStatus(slot)
        const cls = st === 'current' ? 'current-row' : st === 'past' ? 'past-row' : ''
        const timeCls = st === 'current' ? 'time-main current' : 'time-main'

        const cells = sortedRooms.map(room => {
          const bk = bmap.get(bookingKey(slot, today, room.id))
          let boxCls, inner
          if (bk) {
            boxCls = st === 'current' ? 'cell-box taken-cur' : 'cell-box taken-up'
            const parts = bk.studentName.split(' ')
            const first = parts[0] ?? ''
            const rest  = parts.slice(1).join(' ')
            inner = `<div class="cell-name">${esc(first)}${rest ? `<span class="cell-name-last">${esc(rest)}</span>` : ''}</div>`
          } else {
            boxCls = st === 'current' ? 'cell-box free-cur' : 'cell-box free-up'
            inner = `<span class="cell-free-text">Free</span>`
          }
          return `<td><div class="${boxCls}">${inner}</div></td>`
        }).join('')

        return `
          <tr class="${cls}">
            <td class="time-td">
              <div class="${timeCls}">${esc(slot.startTime)}</div>
              <div class="time-end">${esc(slot.endTime)}</div>
              ${st === 'current' ? '<span class="now-pill">NOW</span>' : ''}
            </td>
            ${cells}
          </tr>`
      }).join('')

      return `
        <div class="grid-header">
          <div><div class="grid-title">ROOM BOOKINGS</div><div class="grid-date">${esc(fmtDateLong(now))}</div></div>
          <div class="grid-clock">${esc(fmtTime(now))}</div>
        </div>
        <div class="grid-body">
          <table class="grid-table">
            <thead><tr><th>Time</th>${roomThs}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div class="grid-footer">Updates in real time · CineForge</div>`
    }

    // ── Clock tick ───────────────────────────────────────────────────────────
    setInterval(render, 30_000)

    // ── Firestore listeners ──────────────────────────────────────────────────
    function subscribe() {
      const today = todayStr()

      onSnapshot(
        query(collection(db, 'rooms'), where('isActive', '==', true)),
        snap => {
          const prev = rooms.length
          rooms = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          // On first load, honour the URL ?room= hint
          if (prev === 0 && urlRoom) {
            const match = rooms.find(r =>
              r.name.split(' ').pop()?.toUpperCase() === urlRoom.toUpperCase() ||
              r.name.toUpperCase() === urlRoom.toUpperCase()
            )
            if (match) activeRoomId = match.id
          }
          render()
        },
        err => {
          document.getElementById('app').innerHTML =
            `<div class="center-screen"><span class="error">Firestore error</span><span style="font-size:13px;font-family:monospace">${esc(err.message)}</span></div>`
        }
      )

      // room_slots: the public copy of room_bookings (room, time, first name)
      // that onRoomBookingWritten keeps in step; room_bookings needs sign-in
      onSnapshot(
        query(collection(db, 'room_slots'), where('date', '==', today)),
        snap => { bookings = snap.docs.map(d => ({ id: d.id, ...d.data() })); render() },
        err => { console.error('room_slots listener failed', err) }
      )
    }

    subscribe()

    // Re-subscribe at midnight so the date filter updates
    const msToMidnight = () => {
      const n = new Date(), m = new Date(n)
      m.setHours(24, 0, 0, 0)
      return m - n
    }
    setTimeout(function midnight() {
      subscribe()
      setTimeout(midnight, 86_400_000)
    }, msToMidnight())
